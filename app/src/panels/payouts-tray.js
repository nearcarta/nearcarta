// Payouts tray. Same card as the Ferry: tabs, icon flow, labelled fields, one gold button.
// The gold button and the agent call the same functions. Nothing here signs.
import { addPayoutRow, formatNear, parseCsv, prepareRows } from '../../design/D8_shops/js/payouts.js';
import { downloadCsv } from '../chronicle-feed.js';
import { payoutFlow } from './payout-marks.js';
import { qrSvg } from './qr-svg.js';
import {
  accountantCsv, agentCommand, classifyPayroll, invoiceDoneLine, invoiceStatusLine, nearFromYocto, payrollKey, rowsForCommand,
} from './payouts-plan.js';
import { armPayoutsDock, ensurePayoutsDock } from './payouts-dock.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
const q$ = (root, sel) => root.querySelector(sel);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoLocal = d => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
function shiftDays(n, hour) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  if (hour != null) d.setHours(hour, 0, 0, 0);
  return d;
}
function expiryIso(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

const CHAINS = [['near', 'NEAR'], ['base', 'Base'], ['eth', 'Ethereum'], ['arb', 'Arbitrum']];
const ASSETS = ['NEAR', 'USDC'];

function fixtureOf() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('payoutFixture');
    return ['empty', 'error', 'refused', 'held', 'paid'].includes(q) ? q : '';
  } catch { return ''; }
}

export function mountPayouts(root, hooks) {
  const state = hooks.state || (hooks.state = {});
  if (!state.rows) state.rows = [];
  if (!state.tab) state.tab = 'invoice';
  if (!state.settled) state.settled = {};
  if (state.invoiceUsd == null) state.invoiceUsd = '';
  if (state.due == null) state.due = isoDate(shiftDays(7));
  if (state.expiry == null) state.expiry = isoLocal(shiftDays(14, 18));
  const fix = fixtureOf();
  if (fix && !state.fixtureApplied) {
    state.fixtureApplied = true;
    state.tab = fix === 'empty' || fix === 'error' ? 'invoice' : 'payroll';
    state.fixture = fix;
    state.line = 'Fixture. Not a live payment.';
    if (fix === 'error') state.line2 = 'The invoice was not created.';
    if (fix === 'refused') {
      state.rows = [{ to: 'cafe.near', amt: '1', asset: 'NEAR', chain: 'near' }];
      state.line2 = 'Refused before any deposit.';
      state.seal = state.line2;
    }
    if (fix === 'held') {
      state.rows = [{ to: '0x' + 'ab'.repeat(20), amt: '0.15', asset: 'USDC', chain: 'base' }];
      state.line2 = 'Held. The foreign amount is not checked on the live board.';
    }
    if (fix === 'paid') state.line2 = 'Labelled sample. Paid only after 1Click SUCCESS.';
    if (fix === 'refused' || fix === 'held' || fix === 'paid') {
      state.payLine = state.line;
      state.payLine2 = state.line2;
    }
  }
  const liveCap = () => {
    const fromHook = hooks.capNear ? hooks.capNear() : null;
    if (fromHook != null && fromHook !== '') return Number(fromHook);
    return state.capNear == null ? null : Number(state.capNear);
  };
  const clearSeal = () => { if (state.fixture) return; state.seal = ''; hooks.hideRefuse?.(); };
  const showSeal = (text) => { state.seal = text || ''; if (text) hooks.showRefuse?.(text); else hooks.hideRefuse?.(); };
  const accountId = () => (hooks.account ? hooks.account() : '') || '';
  const lines = (a = state.line, b = state.line2) => `<div class="payout-status" data-testid="payout-status"><p class="ferry-rate" data-testid="payout-line">${esc(a || '')}</p><p class="payout-calm" data-testid="payout-line-2">${esc(b || '')}</p></div>`;
  function resultCard() {
    const inv = state.invoice;
    const url = state.payUrl;
    if (!inv || !url || state.tab !== 'invoice') return '';
    let qr = '';
    try { qr = qrSvg(url); } catch { qr = ''; }
    return `<div class="payout-result" data-testid="payout-result">
      <p class="payout-facts">${esc(inv.id)} · ${esc(inv.usd)} USD · ${esc(inv.receive)}${state.expiry ? ` · expires ${esc(String(state.expiry).replace('T', ' '))}` : ''}</p>
      <p class="payout-link"><a href="${esc(url)}" data-testid="payout-link">${esc(url)}</a></p>
      <button type="button" id="p-copy" data-testid="payout-copy">Copy link</button>
      <div class="payout-qr" data-testid="payout-qr">${qr}</div>
      <p class="payout-calm">Creating an invoice signs nothing.</p>
    </div>`;
  }

  async function loadCap() {
    if (state.capLoaded || liveCap() != null || state.fixture) return;
    const id = accountId();
    if (!id) return;
    state.capLoaded = true;
    try {
      const body = await fetch(api() + '/api/board/row/' + encodeURIComponent(id) + '?fresh=1').then(r => r.json());
      const y = body?.row?.per_action_cap;
      if (y != null && y !== '') state.capNear = nearFromYocto(y);
    } catch { /* the cap line stays unread */ }
    if (root.isConnected && state.tab === 'payroll') render();
  }

  function capSentence() {
    const cap = liveCap();
    if (cap == null || !Number.isFinite(cap)) return 'Your /setup cap is unread. A NEAR payment waits.';
    return `Your /setup cap: ${formatNear(cap)} NEAR per payment.`;
  }

  function receiptHtml(list) {
    return (list || []).map(r => {
      const tail = r.status || (r.tx ? 'sent' : 'not sent');
      const link = r.url ? ` <a href="${esc(r.url)}">Receipt</a>` : '';
      return `<li data-testid="payout-receipt">${esc(r.to)} ${esc(r.amount)} ${esc(r.asset)} · ${esc(tail)}${link}</li>`;
    }).join('');
  }

  function rowsFromPlan(plan) {
    return plan.rows.map((r, i) => ({
      n: i + 1,
      to: r.to,
      amount: r.amt,
      asset: r.asset,
      source: r.chain,
      destination: r.to,
      fee: '',
      refund: '',
      status: r.action === 'propose' ? 'not sent' : r.action === 'refused' ? 'refused' : r.action === 'held' || r.action === 'hold' ? 'held' : 'not sent',
      tx: '',
    }));
  }

  function prepareNow() {
    if (state.fixture) return { ok: false, hint: 'Fixture. Not a live payment.' };
    clearSeal();
    const parsed = parseCsv(state.csv || q$(root, '#p-csv')?.value || '');
    const use = parsed.length ? parsed.map(r => ({ ...r, chain: String(r.asset).toUpperCase() === 'USDC' ? 'base' : 'near' })) : state.rows;
    const prep = prepareRows(use);
    if (prep.blocked) {
      state.receipts = [];
      state.usdcNote = '';
      state.dropNote = prep.note;
      render();
      return { ok: true, hint: prep.note || 'A row needs a payee. Nothing was prepared.' };
    }
    if (parsed.length) state.rows = prep.rows.slice(0, 3);
    const plan = classifyPayroll(prep.rows, { capNear: liveCap() });
    state.receipts = rowsFromPlan(plan);
    state.usdcNote = plan.held.some(r => r.asset === 'USDC') ? 'Not sent. Foreign USDC is held.' : '';
    state.dropNote = prep.note || '';
    state.payLine = plan.refused.length ? 'Refused before any deposit.' : 'Reviewed. Nothing was sent.';
    state.payLine2 = state.usdcNote || '';
    render();
    return { ok: true, hint: 'Prepared. Nothing was sent.' };
  }

  async function payReviewed(list) {
    if (state.fixture) return { ok: false, hint: 'Fixture. Not a live payment.' };
    clearSeal();
    const prep = prepareRows(list);
    if (prep.blocked) {
      state.dropNote = prep.note;
      render();
      return { ok: false, hint: prep.note || 'A row needs a payee. Nothing was sent.' };
    }
    const cap = liveCap();
    const plan = classifyPayroll(prep.rows, { capNear: cap });
    const fresh = plan.propose.filter(r => !state.settled[payrollKey(r)]);
    const replayed = plan.propose.filter(r => state.settled[payrollKey(r)]);
    state.receipts = rowsFromPlan(plan);
    for (const r of replayed) {
      const hit = state.receipts.find(x => x.to === r.to && String(x.amount) === String(r.amt));
      if (hit) { hit.status = 'sent'; hit.tx = state.settled[payrollKey(r)]; hit.url = `https://nearblocks.io/txns/${hit.tx}`; }
    }
    if (!fresh.length) {
      const hint = plan.refused.length ? 'Refused before any deposit. Nothing was sent.'
        : replayed.length ? 'Already sent. Not sent again.'
        : plan.held.length ? 'Held. Nothing was sent.'
        : 'Nothing was sent.';
      state.payLine = hint;
      state.payLine2 = '';
      if (plan.refused.length) showSeal(hint);
      state.usdcNote = plan.held.some(r => r.asset === 'USDC') ? 'Not sent. Foreign USDC is held.' : '';
      render();
      return { ok: replayed.length > 0 && !plan.refused.length, hint, replayed: replayed.length > 0 };
    }
    if (typeof hooks.onPay !== 'function') {
      state.payLine = 'Finish /setup in the city. Nothing was sent.';
      state.payLine2 = '';
      render();
      return { ok: false, hint: state.payLine };
    }
    const sendRows = fresh.map(r => ({ to: r.to, amt: String(r.amt), asset: 'NEAR', chain: 'near' }));
    const result = await hooks.onPay(sendRows, { capNear: cap });
    const steps = result?.o?.steps || [];
    fresh.forEach((r, i) => {
      const step = steps[i];
      const row = state.receipts.find(x => x.to === r.to && String(x.amount) === String(r.amt) && x.asset === 'NEAR');
      if (!row) return;
      if (step?.decision === 'allowed' && step.tx) {
        row.status = 'sent'; row.tx = step.tx; row.url = `https://nearblocks.io/txns/${step.tx}`;
        state.settled[payrollKey(r)] = step.tx;
      } else if (step) row.status = 'refused';
    });
    const cinema = !plan.refused.length && !plan.held.length && (result?.ok === true);
    if (plan.refused.length) showSeal('Refused before any deposit.');
    else if (cinema) { clearSeal(); hooks.onCinema?.({ paid: true, refused: false }); }
    else if (result?.seal) showSeal(result.seal);
    state.payLine = plan.refused.length ? 'Refused before any deposit.' : (result?.hint || 'Reviewed.');
    state.payLine2 = '';
    state.usdcNote = plan.held.some(r => r.asset === 'USDC') ? 'Not sent. Foreign USDC is held.' : '';
    render();
    return result || { ok: false, hint: state.payLine };
  }

  async function createLink() {
    if (state.fixture) return { ok: false, hint: 'Fixture. Not a live payment.' };
    clearSeal();
    const receive = String(state.receive || accountId() || '').trim();
    const usd = Number(state.invoiceUsd);
    if (!(usd > 0)) {
      state.line = 'Name the invoice amount, for example 0.15 USD.';
      state.line2 = '';
      render();
      return { ok: false, hint: state.line };
    }
    if (!receive) {
      state.line = 'Type the receive account. Nothing was created.';
      state.line2 = '';
      render();
      return { ok: false, hint: state.line };
    }
    let j;
    try {
      const res = await fetch(api() + '/api/payouts/invoices', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usd, receive, memo: state.memo || '', due: state.due || '', expiry: expiryIso(state.expiry) }),
      });
      j = await res.json();
    } catch (e) {
      j = { ok: false, reason: e?.message || 'The invoice did not save.' };
    }
    if (!j?.ok) {
      state.line = j?.reason === 'missing_account' ? 'The invoice was not created.'
        : j?.reason === 'hosted_abuse_ceiling' ? 'Over the hosted abuse ceiling. No link was created.'
        : 'The invoice was not created. Nothing was sent.';
      state.line2 = j?.reason === 'missing_account' ? (j.text || 'That NEAR account does not exist.') : (j?.ceiling?.disclosed || '');
      render();
      return { ok: false, hint: state.line };
    }
    state.invoice = j.invoice;
    const origin = globalThis.location?.origin || '';
    state.payUrl = origin + (j.invoice?.href || '');
    state.line = 'Invoice created. Nothing was signed.';
    state.line2 = 'Checking USDC registration.';
    render();
    lookUpRegistration(receive);
    return { ok: true, hint: invoiceDoneLine(j.invoice, origin) };
  }

  async function lookUpRegistration(account) {
    try {
      const res = await fetch(api() + '/api/payouts/registration?account=' + encodeURIComponent(account));
      const body = await res.json();
      if (body?.reason === 'missing_account' || body?.claim === 'missing') {
        state.line2 = body.text || `${account} does not exist on NEAR.`;
      } else {
        state.line2 = body?.text || 'USDC registration is unknown. The invoice is still valid.';
      }
      if (root.isConnected) render();
    } catch {
      state.line2 = 'USDC registration is unknown. The invoice is still valid.';
      if (root.isConnected) render();
    }
  }

  function exportCsvNow() {
    clearSeal();
    const csv = accountantCsv(state.receipts || []);
    state.csvOut = csv;
    downloadCsv(csv, 'payouts.csv');
    state.tab = 'csv';
    state.line = 'CSV ready. A row without a tx says not sent.';
    state.line2 = '';
    render();
    return { ok: true, hint: state.line };
  }

  async function runAgent(text) {
    if (state.fixture) return { ok: false, hint: 'Fixture. Not a live payment.' };
    clearSeal();
    const cmd = agentCommand(text);
    if (!cmd.ok) return cmd;
    if (cmd.kind === 'csv') return { clear: true, ...exportCsvNow() };
    if (cmd.kind === 'status') {
      const origin = globalThis.location?.origin || '';
      const hint = state.invoice ? invoiceDoneLine(state.invoice, origin) : capSentence();
      state.line = state.invoice ? invoiceStatusLine(state.invoice.status) : capSentence();
      state.line2 = state.invoice ? 'Creating an invoice signs nothing.' : '';
      render();
      return { ok: true, clear: true, hint };
    }
    if (cmd.kind === 'invoice') {
      state.tab = 'invoice';
      state.invoiceUsd = String(cmd.usd);
      if (cmd.receive) state.receive = cmd.receive;
      if (cmd.memo) state.memo = cmd.memo;
      return { clear: true, ...(await createLink()) };
    }
    if (cmd.kind === 'pay') {
      const picked = rowsForCommand(state.rows, cmd);
      if (!picked.length) return { ok: false, hint: 'That payout is not on the list. Nothing was sent.' };
      state.tab = 'payroll';
      return { clear: true, ...(await payReviewed(picked)) };
    }
    return { ok: false, hint: cmd.hint };
  }

  if (!root.dataset.keys) {
    root.dataset.keys = '1';
    const stopKeys = (e) => {
      const t = e.target;
      if (!t?.closest || t.closest('#p-agent, #f-agent, #t-agent')) return;
      if (t.closest('input, textarea, select')) e.stopPropagation();
    };
    root.addEventListener('keydown', stopKeys);
    root.addEventListener('keyup', stopKeys);
  }
  const render = () => {
    const mem = typeof document !== 'undefined' && document.activeElement && root.contains(document.activeElement)
      ? { id: document.activeElement.id, i: document.activeElement.dataset?.i || '', cls: document.activeElement.className || '', start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
      : null;
    const take = (sel, key) => { const el = q$(root, sel); if (el) state[key] = el.value; };
    take('#p-usd', 'invoiceUsd');
    take('#p-receive', 'receive');
    take('#p-memo', 'memo');
    take('#p-due', 'due');
    take('#p-expiry', 'expiry');
    root.querySelectorAll('.p-to').forEach(el => { const row = state.rows[+el.dataset.i]; if (row) row.to = el.value; });
    root.querySelectorAll('.p-amt').forEach(el => { const row = state.rows[+el.dataset.i]; if (row) row.amt = el.value; });
    const tab = state.tab || 'invoice';
    const full = state.rows.length >= 3;
    const tabs = `<div class="ferry-tabs" role="tablist" data-testid="payouts-tabs">
      <button type="button" role="tab" class="ferry-tab${tab === 'invoice' ? ' on' : ''}" data-tab="invoice" aria-selected="${tab === 'invoice'}" data-testid="payouts-tab-invoice">Invoice</button>
      <button type="button" role="tab" class="ferry-tab${tab === 'payroll' ? ' on' : ''}" data-tab="payroll" aria-selected="${tab === 'payroll'}" data-testid="payouts-tab-payroll">Payroll</button>
      <button type="button" role="tab" class="ferry-tab${tab === 'csv' ? ' on' : ''}" data-tab="csv" aria-selected="${tab === 'csv'}" data-testid="payouts-tab-csv">CSV</button>
    </div>`;
    const invoice = `<div class="ferry-pane" data-pane="invoice" ${tab === 'invoice' ? '' : 'hidden'}>
      ${payoutFlow('invoice')}
      <label class="field ferry-field"><span>Amount USD</span><input id="p-usd" data-testid="payout-invoice-usd" inputmode="decimal" placeholder="for example 0.15" value="${esc(state.invoiceUsd || '')}"></label>
      <label class="field ferry-field"><span>Receive account</span><input id="p-receive" data-testid="payout-receive" value="${esc(state.receive || '')}" autocomplete="off" placeholder="name.near"></label>
      <label class="field ferry-field"><span>Memo</span><input id="p-memo" data-testid="payout-memo" value="${esc(state.memo || '')}" maxlength="140" placeholder="what this is for"></label>
      <label class="field ferry-field"><span>Due</span><input id="p-due" data-testid="payout-due" type="date" value="${esc(state.due || '')}"></label>
      <label class="field ferry-field"><span>Expiry</span><input id="p-expiry" data-testid="payout-expiry" type="datetime-local" value="${esc(state.expiry || '')}"></label>
      <button type="button" class="primary ferry-cta" id="p-create" data-testid="payout-create">Create invoice link</button>
      ${lines()}
      ${resultCard()}
    </div>`;
    const rowList = state.rows.map((r, i) => {
      const asset = String(r.asset || 'NEAR').toUpperCase();
      const chain = String(r.chain || (asset === 'USDC' ? 'base' : 'near')).toLowerCase();
      const chainOpts = CHAINS.map(([id, name]) => `<option value="${id}"${chain === id ? ' selected' : ''}>${name}</option>`).join('');
      const assetOpts = ASSETS.map(a => `<option${asset === a ? ' selected' : ''}>${a}</option>`).join('');
      return `<li class="payout-row">
        <label class="field ferry-field"><span>Receiver</span><input class="p-to" data-i="${i}" data-testid="payout-to" value="${esc(r.to || '')}" autocomplete="off"></label>
        <div class="payout-split">
          <label class="field ferry-field"><span>Chain</span><select class="p-chain" data-i="${i}" data-testid="payout-chain">${chainOpts}</select></label>
          <label class="field ferry-field"><span>Asset</span><select class="p-asset" data-i="${i}" data-testid="payout-asset">${assetOpts}</select></label>
          <label class="field ferry-field"><span>Amount ${esc(asset)}</span><input class="p-amt" data-i="${i}" data-testid="payout-amt" inputmode="decimal" placeholder="0.1" value="${esc(formatNear(r.amt))}"></label>
        </div>
      </li>`;
    }).join('');
    const payroll = `<div class="ferry-pane" data-pane="payroll" ${tab === 'payroll' ? '' : 'hidden'}>
      ${payoutFlow('payroll')}
      ${state.payLine ? lines(state.payLine, state.payLine2) : `<div class="payout-status" data-testid="payout-status"><p class="payout-calm" data-testid="payout-caps">${esc(capSentence())}</p><p class="payout-calm"></p></div>`}
      <ol class="plist" data-testid="payout-list">${rowList}</ol>
      <button type="button" id="p-add" data-testid="payout-add"${full ? ' disabled data-reason="Three rows is the daily count on this charter."' : ''}>Add a row</button>
      <p data-testid="payout-add-note">${full ? 'Three rows is the daily count on this charter.' : ''}</p>
      <label class="field ferry-field"><span>CSV</span><textarea id="p-csv" data-testid="payout-csv" rows="2" placeholder="account,amount,asset">${esc(state.csv || '')}</textarea></label>
      <button type="button" id="p-prep" data-testid="payout-prepare">Review these rows</button>
      <button type="button" class="primary ferry-cta" id="p-pay" data-testid="payout-send">Pay reviewed rows</button>
      <p data-testid="payout-drop"${state.dropNote ? '' : ' hidden'}>${esc(state.dropNote || '')}</p>
      <ul data-testid="payout-receipts">${receiptHtml(state.receipts)}</ul>
      <p data-testid="payout-usdc"${state.usdcNote ? '' : ' hidden'}>${esc(state.usdcNote || '')}</p>
    </div>`;
    const csvPane = `<div class="ferry-pane" data-pane="csv" ${tab === 'csv' ? '' : 'hidden'}>
      <p class="ferry-picker-note">The file lists source, destination, fee and refund. A row with no tx says not sent.</p>
      <button type="button" class="primary ferry-cta" id="p-export" data-testid="payout-export">Export accountant CSV</button>
      <pre data-testid="payout-csv-out">${esc(state.csvOut || '')}</pre>
      ${lines()}
    </div>`;
    root.innerHTML = `<div class="shop-stack ferry-card" data-testid="payouts-card">${tabs}${invoice}${payroll}${csvPane}</div>`;
    const bind = (id, key) => { const el = q$(root, id); if (el) el.oninput = (e) => { state[key] = e.target.value; clearSeal(); }; };
    bind('#p-usd', 'invoiceUsd');
    bind('#p-receive', 'receive');
    bind('#p-memo', 'memo');
    bind('#p-due', 'due');
    bind('#p-expiry', 'expiry');
    root.querySelectorAll('.p-to').forEach(el => { el.oninput = () => { state.rows[+el.dataset.i].to = el.value; clearSeal(); }; });
    root.querySelectorAll('.p-amt').forEach(el => { el.oninput = () => { state.rows[+el.dataset.i].amt = el.value; clearSeal(); }; });
    root.querySelectorAll('.p-chain').forEach(el => { el.onchange = () => { state.rows[+el.dataset.i].chain = el.value; clearSeal(); render(); }; });
    root.querySelectorAll('.p-asset').forEach(el => { el.onchange = () => { state.rows[+el.dataset.i].asset = el.value; clearSeal(); render(); }; });
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => { clearSeal(); state.tab = btn.dataset.tab || 'invoice'; render(); };
    });
    const add = q$(root, '#p-add');
    if (add) add.onclick = () => {
      clearSeal();
      const next = addPayoutRow(state.rows);
      state.rows = next.rows;
      render();
    };
    const csv = q$(root, '#p-csv');
    if (csv) csv.oninput = (e) => { state.csv = e.target.value; };
    const prep = q$(root, '#p-prep');
    if (prep) prep.onclick = () => prepareNow();
    const pay = q$(root, '#p-pay');
    if (pay) pay.onclick = () => payReviewed(state.rows);
    const create = q$(root, '#p-create');
    if (create) create.onclick = () => createLink();
    const copy = q$(root, '#p-copy');
    if (copy) copy.onclick = async () => {
      const url = state.payUrl || '';
      try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied'; }
      catch {
        const area = document.createElement('textarea');
        area.value = url;
        root.appendChild(area);
        area.select();
        try { document.execCommand('copy'); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select the link'; }
        area.remove();
      }
    };
    if (mem) {
      let el = mem.id ? root.querySelector('#' + CSS.escape(mem.id)) : null;
      if (!el && mem.i !== '' && mem.cls) {
        const cls = String(mem.cls).split(/\s+/).find(Boolean);
        if (cls) el = root.querySelector(`.${CSS.escape(cls)}[data-i="${mem.i}"]`);
      }
      if (el?.focus) {
        el.focus({ preventScroll: true });
        try { if (mem.start != null && el.setSelectionRange) el.setSelectionRange(mem.start, mem.end); } catch { /* date inputs have no caret */ }
      }
    }
    const exp = q$(root, '#p-export');
    if (exp) exp.onclick = () => exportCsvNow();
    const doc = typeof document !== 'undefined' ? document : null;
    if (doc && hooks.dock !== false) {
      ensurePayoutsDock(doc);
      armPayoutsDock((text) => runAgent(text));
    }
  };
  render();
  loadCap();
}
