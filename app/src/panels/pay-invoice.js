// Payer page for /pay/<id>. Dry quote, then a deposit address. This page does not send the deposit.
import { CHAIN_FILE } from './icon-map.js';
import { apiFetch } from '../../../shared/net/net.js';
import { addressOk, invoiceStatusLine, quoteLine, usdcChoices } from './payouts-plan.js';

const $ = s => document.querySelector(s);
const id = location.pathname.split('/').filter(Boolean).pop();
let record = null;
let pollTimer = 0;
let quoteTimer = 0;

function chain() {
  return $('#pay-from')?.value || 'base';
}
function fromRef() {
  const opt = $('#pay-from')?.selectedOptions?.[0];
  return opt?.dataset.from || `USDC@${chain()}`;
}
function setLine(a, b) {
  const line = $('#pay-line');
  const more = $('#pay-line-2');
  if (line) line.textContent = a || '';
  if (more) more.textContent = b || '';
}
function setQuote(text) {
  const el = $('#pay-quote');
  if (el) el.textContent = text || '';
}

function fillChains(choices) {
  const sel = $('#pay-from');
  if (!sel || !choices?.length) return;
  const current = sel.value || 'base';
  sel.replaceChildren(...choices.map(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.dataset.from = c.assetId || `USDC@${c.id}`;
    opt.textContent = c.label;
    return opt;
  }));
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
  paintChain();
}

function paintChain() {
  const file = CHAIN_FILE[chain()] || chain();
  const img = $('#pay-chain');
  if (img) img.src = `/tokens/chains/${file}.svg`;
}

async function loadChains() {
  try {
    const res = await apiFetch('/api/ferry/tokens');
    const body = await res.json();
    fillChains(usdcChoices(body.tokens || body));
  } catch {
    fillChains(usdcChoices([]));
  }
}

function paint(inv) {
  record = inv;
  $('#pay-usd').value = inv ? String(inv.usd) : '';
  $('#pay-receive').value = inv ? inv.receive : '';
  if (!inv) { setLine('This invoice was not found.', ''); return; }
  if (inv.delivered === true || inv.status === 'SUCCESS') {
    setLine(invoiceStatusLine('SUCCESS'), inv.receipt || '');
    return;
  }
  setLine(invoiceStatusLine(inv.status || 'UNPAID'), '');
}

async function load() {
  if (!id || id === 'pay' || id === 'index.html') { setLine('Missing invoice link.', ''); return; }
  try {
    const res = await apiFetch('/api/payouts/invoices/' + encodeURIComponent(id) + location.search);
    const body = await res.json();
    paint(body.invoice || null);
    if (body.invoice?.depositAddress) showDeposit(body.invoice.depositAddress);
    if (body.invoice) scheduleQuote();
  } catch { setLine('The invoice could not be read.', ''); }
}

async function refreshQuote() {
  if (!record) return;
  const typed = $('#pay-refund').value.trim();
  if (typed && !addressOk(chain(), typed)) { setQuote('That refund address does not match this chain.'); return; }
  setQuote('Reading the 1Click quote.');
  const payload = { from: fromRef(), chain: chain(), recipientType: 'DESTINATION_CHAIN' };
  if (typed) payload.refundTo = typed;
  else payload.indicative = true;
  try {
    const res = await apiFetch('/api/payouts/invoices/' + encodeURIComponent(record.id) + '/quote', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!body.ok) { setQuote(body.error || '1Click did not quote this amount.'); return; }
    const note = body.indicative ? ' Indicative quote. The refund address is only needed for the deposit address.' : '';
    setQuote((quoteLine(body) || 'Quote ready. Nothing was sent.') + note);
  } catch { setQuote('The quote could not be read.'); }
}

function scheduleQuote() {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(refreshQuote, 350);
}

function showDeposit(address) {
  const box = $('#pay-deposit');
  const input = $('#pay-address');
  if (input) input.value = address || '';
  if (box) box.hidden = !address;
}

function paintLive(body) {
  const status = body?.status || '';
  const delivered = body?.delivered === true || status === 'SUCCESS';
  setLine(invoiceStatusLine(delivered ? 'SUCCESS' : (status || 'UNPAID')), '');
  const links = $('#pay-links');
  if (links) {
    links.replaceChildren(...(body?.links || []).filter(l => l?.href).map(l => {
      const a = document.createElement('a');
      a.href = l.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = l.label;
      return a;
    }));
  }
  const receipt = $('#pay-receipt');
  if (receipt) receipt.textContent = body?.receipt || '';
  if (body?.depositAddress) showDeposit(body.depositAddress);
  return delivered || status === 'REFUNDED' || status === 'FAILED';
}

async function poll() {
  if (!record) return;
  try {
    const res = await apiFetch('/api/payouts/invoices/' + encodeURIComponent(record.id) + '/status');
    const body = await res.json();
    if (paintLive(body)) return;
  } catch { setLine('Not paid.', 'Status could not be read. Still waiting.'); }
  pollTimer = setTimeout(poll, 4000);
}

$('#pay-from')?.addEventListener('change', () => { paintChain(); scheduleQuote(); });
$('#pay-refund')?.addEventListener('input', scheduleQuote);
$('#pay-copy')?.addEventListener('click', async () => {
  const value = $('#pay-address')?.value || '';
  const btn = $('#pay-copy');
  try { await navigator.clipboard.writeText(value); if (btn) btn.textContent = 'Copied'; }
  catch { if (btn) btn.textContent = 'Select the address'; }
});
$('#pay-go')?.addEventListener('click', async () => {
  if (!record) return;
  const refundTo = $('#pay-refund').value.trim();
  if (!refundTo) { setLine('Not paid.', 'Type the refund address.'); return; }
  if (!addressOk(chain(), refundTo)) { setLine('Not paid.', 'That refund address does not match this chain.'); return; }
  setLine('Asking for a deposit address. Not paid.', '');
  try {
    const res = await apiFetch('/api/payouts/invoices/' + encodeURIComponent(record.id) + '/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: fromRef(), chain: chain(), refundTo, recipientType: 'DESTINATION_CHAIN' }),
    });
    const body = await res.json();
    if (!body.ok) { setLine('Not paid.', body.error || body.reason || 'No deposit address.'); return; }
    if (body.delivered) { setLine('Delivered.', body.receipt || ''); return; }
    showDeposit(body.depositAddress || '');
    setLine('Not paid.', 'Deposit address ready. Send the quoted USDC yourself.');
    clearTimeout(pollTimer);
    poll();
  } catch { setLine('Not paid.', 'Checkout did not answer.'); }
});

loadChains();
load();
