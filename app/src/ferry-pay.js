// Embeddable Pay button. A host page includes this script; it renders into #nearcarta-pay
// (or the element named by data-root) and talks to this origin's /api. The charter is read
// before a deposit address is asked for. This file never sends the deposit.
import { tokenChoices, chainsOf, filterTokens, quoteView, pickBest, statusView } from './ferry-catalog.js';
import { pickerListbox, bindPickerListbox, bindTokenFallbacks } from './panels/token-badge.js';

const me = document.currentScript || document.querySelector('script[src*="ferry-pay.js"]');
const origin = me ? new URL(me.src, location.href).origin : '';
const rootId = (me && me.dataset.root) || 'nearcarta-pay';
const root = document.getElementById(rootId);
if (root) {
  const preset = {
    charter: (me && me.dataset.charter) || new URLSearchParams(location.search).get('charter') || '',
    clause: (me && me.dataset.clause) || new URLSearchParams(location.search).get('clause') || 'pay',
    recipient: (me && me.dataset.recipient) || new URLSearchParams(location.search).get('recipient') || '',
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let choices = [];
  root.innerHTML = `
    <form id="nc-pay">
      <label>Find a token <input name="q" data-testid="widget-search" placeholder="USDC, near, base"></label>
      <label>Chain <span data-host="chain"></span></label>
      <label>Pay with <span data-host="from"></span></label>
      <label>Receive <span data-host="to"></span></label>
      <label>Amount <input name="amount" value="0.2" inputmode="decimal" data-testid="widget-amount"></label>
      <label>Paid to <input name="recipient" readonly data-testid="widget-recipient" placeholder="the charter’s recipient"></label>
      <label>Your refund address, on the chain you pay from <input name="refundTo" required placeholder="0x…" data-testid="widget-refund"></label>
      <button type="button" data-testid="widget-quote">See the quote</button>
      <button type="button" data-testid="widget-compare">Compare a confidential quote</button>
      <button type="button" data-testid="widget-routes">Compare two routes</button>
      <div data-testid="widget-quotes"></div>
      <button type="submit" data-testid="widget-pay">Pay</button>
    </form>
    <p id="nc-out" data-testid="widget-out"></p>
    <p id="nc-status" data-testid="widget-status"></p>
    <p id="nc-refund" data-testid="widget-refund-note" hidden></p>`;
  const out = root.querySelector('#nc-out');
  const statusEl = root.querySelector('#nc-status');
  const refundEl = root.querySelector('#nc-refund');
  const quotesEl = root.querySelector('[data-testid=widget-quotes]');
  const form = root.querySelector('#nc-pay');
  const amount = form.querySelector('[name=amount]');
  const recipient = form.querySelector('[name=recipient]');
  const search = form.querySelector('[name=q]');
  let payId = '';
  let recvId = '';
  let chainFilterValue = '';
  const host = name => form.querySelector(`[data-host="${name}"]`);
  const writeBox = (name, testid, options, selected, onChange) => {
    const slot = host(name);
    if (!slot) return;
    slot.innerHTML = pickerListbox({ id: 'nc-' + name, testid, options, selected });
    bindPickerListbox(slot.querySelector('.token-listbox'), onChange || (() => {}));
    bindTokenFallbacks(slot);
  };
  const tokenOptions = list => list.map(t => ({ value: t.id, label: t.label, symbol: t.symbol, chain: t.chain, icon: t.icon || '' }));
  const renderPay = () => {
    const list = filterTokens(choices, { q: search.value, chain: chainFilterValue });
    const opts = tokenOptions(list);
    if (!opts.some(o => o.value === payId)) payId = opts[0]?.value || '';
    writeBox('from', 'widget-chain', opts, payId, (value) => { payId = value; });
    if (!opts.some(o => o.value === recvId)) {
      const usdc = list.find(t => t.symbol === 'USDC' && t.chain === 'near') || list[0];
      recvId = usdc?.id || '';
    }
    writeBox('to', 'widget-receive', opts, recvId, (value) => { recvId = value; });
  };
  const renderChain = () => {
    const options = [{ value: '', label: 'All chains', kind: 'chain' }].concat(chainsOf(choices).map(c => ({ value: c, label: c, kind: 'chain' })));
    writeBox('chain', 'widget-chain-filter', options, chainFilterValue, (value) => { chainFilterValue = value; renderPay(); });
  };
  search.oninput = renderPay;
  let rules = null;
  const api = p => fetch(origin + p).then(r => r.json().then(j => ({ ok: r.ok, j })));
  async function loadTokens() {
    const { ok, j } = await api('/api/ferry/tokens');
    choices = tokenChoices(Array.isArray(j) ? j : j?.tokens || []);
    renderChain();
    renderPay();
    if (!ok && !choices.length) out.textContent = 'The token list did not load. The four common pairs are still a quote away once it does.';
  }
  async function loadRules(charter) {
    out.textContent = 'Reading the charter…';
    const q = new URLSearchParams({ charter, clause: preset.clause });
    const { j } = await api('/api/ferry/rules?' + q);
    rules = j;
    const list = j.receivers || [];
    const pick = preset.recipient || list[0] || '';
    recipient.value = pick;
    if (preset.recipient && list.length && !list.includes(preset.recipient)) { out.textContent = 'That recipient is not on the charter list.'; return; }
    if (!j.ok) { out.textContent = 'The charter will not take this payment' + (j.reason ? ': ' + j.reason : '') + '.'; return; }
    out.textContent = 'The charter allows ' + pick + '. At most 0.20 USD. Pay asks for a deposit address. You send the tokens yourself. A confidential quote is a quote only, not a settled private swap.';
  }
  function pair() {
    const [symbol, chainName] = String(payId || '').split('|');
    const [toSymbol, toChain] = String(recvId || 'USDC|near').split('|');
    return { from: { symbol, chain: chainName }, to: { symbol: toSymbol || 'USDC', chain: toChain || 'near' } };
  }
  function paintQuotes(rows) {
    const views = pickBest(rows);
    quotesEl.innerHTML = views.map((v, i) => `<p data-testid="quote-row"${v.best ? ' data-best="1"' : ''}>Quote ${i + 1}: out ${esc(v.amountOut)} ${esc(v.symbolOut)} · USD ${esc(v.usd ?? '—')} · ETA ${esc(v.eta ?? '—')} s · fee ${esc(v.fee ?? '—')} · ${esc(v.privacy)}${v.dry ? ' · quote only' : ''}${v.best ? ' · best rate' : ''}</p>`).join('');
    const best = views.find(v => v.best);
    if (best) out.textContent = `Best rate: ${best.amountOut} ${best.symbolOut}. Quotes only. Nothing is sent.`;
  }
  async function dryQuote(privacy) {
    const body = { ...pair(), amount: String(amount.value), recipient: recipient.value, refundTo: String(new FormData(form).get('refundTo') || '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e'), privacy };
    const r = await fetch(origin + '/api/ferry/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return quoteView({ ...j, privacy, dry: true, checks: j.checks });
  }
  form.querySelector('[data-testid=widget-quote]').onclick = async () => {
    quotesEl.textContent = 'Asking for a dry quote…';
    paintQuotes([await dryQuote('public')]);
  };
  form.querySelector('[data-testid=widget-compare]').onclick = async () => {
    quotesEl.textContent = 'Comparing two dry quotes…';
    const rows = await Promise.all([dryQuote('public'), dryQuote('basic')]);
    paintQuotes(rows);
    out.textContent = 'The confidential line is a quote only. It is not a settled private swap. The higher amount out is marked best rate.';
  };
  form.querySelector('[data-testid=widget-routes]').onclick = async () => {
    quotesEl.textContent = 'Comparing two routes…';
    const first = await dryQuote('public');
    const alt = choices.find(t => t.id !== payId && t.chain !== String(payId).split('|')[1]) || choices[1];
    const saved = payId;
    if (alt) payId = alt.id;
    const second = await dryQuote('public');
    payId = saved;
    renderPay();
    paintQuotes([first, second]);
  };
  (async () => {
    await loadTokens();
    let charter = preset.charter;
    if (!charter) {
      try { const { j } = await api('/api/mainnet'); charter = j.charter && j.charter.contract || ''; } catch { charter = ''; }
    }
    if (!charter) { out.textContent = 'Name a charter account to pay.'; return; }
    form.dataset.charter = charter;
    await loadRules(charter);
  })();
  let timer = null;
  function paintStatus(j) {
    const v = statusView(j);
    statusEl.textContent = v.help || j.error || v.status || '';
    if (v.tx) statusEl.innerHTML += ` <a class="tx" href="${esc(v.explorer)}" title="${esc(v.tx)}" target="_blank" rel="noopener">${esc(String(v.tx).slice(0, 10))}…</a>`;
    refundEl.hidden = !v.refund;
    if (v.refund) refundEl.textContent = v.status === 'INCOMPLETE_DEPOSIT'
      ? 'The deposit was short. Send the rest to the same address, or wait for the refund to your refund address.'
      : 'Refunded to your refund address. Nothing else is sent from this page.';
    if (v.terminal) clearInterval(timer);
  }
  async function track(depositAddress, memo) {
    const q = new URLSearchParams({ env: 'ONECLICK', depositAddress });
    if (memo) q.set('depositMemo', memo);
    const { j } = await api('/api/ferry/status?' + q);
    paintStatus(j);
  }
  form.onsubmit = async e => {
    e.preventDefault();
    clearInterval(timer);
    statusEl.textContent = '';
    refundEl.hidden = true;
    if (!rules || !rules.ok || !rules.settlement_yocto) { out.textContent = 'The charter has not allowed a payment.'; return; }
    const { from, to } = pair();
    out.textContent = 'Asking the charter, then 1Click…';
    const r = await fetch(origin + '/api/ferry/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      from, to,
      amount: String(amount.value), recipient: recipient.value, refundTo: String(new FormData(form).get('refundTo')),
      charter: form.dataset.charter, clause_id: preset.clause, amount_yocto: rules.settlement_yocto, privacy: 'public',
    }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { out.textContent = j.error || 'The payment was refused.'; return; }
    if (!j.ok || !j.depositAddress) { out.textContent = 'Refused' + (j.reason ? ': ' + j.reason : '') + '. No deposit address.'; return; }
    out.innerHTML = 'Send <b>' + esc(j.usd || amount.value) + ' USD</b> or less to <code data-testid="widget-deposit">' + esc(j.depositAddress) + '</code>'
      + (j.depositMemo ? '<br>Memo <code>' + esc(j.depositMemo) + '</code>' : '')
      + '<br>The charter allowed ' + esc(j.receipt && j.receipt.to) + '. This page does not send the tokens.';
    paintStatus(j);
    timer = setInterval(() => track(j.depositAddress, j.depositMemo), 4000);
    track(j.depositAddress, j.depositMemo);
  };
}
