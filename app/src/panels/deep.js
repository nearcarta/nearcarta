// One shop surface for the city tray, /shops/<name>/ and the console.
// Quote, check, search and prepare only. Nothing here signs a payment.

import { roomError } from '../room-error.js';
import { pickBest, quoteLine } from '../ferry-catalog.js';
import { RECORDED, downloadCsv, exportCsv, queryFeed, verifyEntry } from '../chronicle-feed.js';
import { explainCheck } from '../guard-score.js';
import { TOLL_ADDRESS, TOLL_KEY, checkDerived } from '../toll-derive.js';
import { PROOF_HREF, liveTee, teeView } from '../tee-view.js';
import { NEXT_LABEL, RUN_LABEL } from '../../design/D8_shops/shops/arena-labels.js';
import { attackAt } from '../../design/D8_shops/shops/arenalive.js';
import { addPayoutRow, formatNear, issueText, parseCsv, payoutIssues, prepareRows, receiptsFor, splitAssets } from '../../design/D8_shops/js/payouts.js';
import { visitor } from '../../design/D8_shops/js/session.js';
import { deedMarkup } from './deed.js';
import { boundaryHtml } from './boundary.js';
import { shortId } from './hall-ui.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
const q$ = (root, sel) => root.querySelector(sel);

/** A disabled control stays readable and says why it is waiting. */
function holdButton(btn, reason) {
  if (!btn) return () => {};
  btn.disabled = true;
  btn.dataset.reason = reason;
  let note = btn.nextElementSibling?.dataset?.testid === 'control-reason' ? btn.nextElementSibling : null;
  if (!note) {
    note = document.createElement('p');
    note.dataset.testid = 'control-reason';
    note.className = 'control-reason';
    btn.after(note);
  }
  note.hidden = false;
  note.textContent = reason;
  btn.setAttribute('aria-describedby', 'control-reason');
  note.id = 'control-reason';
  return () => {
    if (!btn.isConnected) return;
    btn.disabled = false;
    delete btn.dataset.reason;
  };
}

export const DEFAULT_ROUTES = [
  { id: 'route.eth-eth.zec', from: 'ETH@eth', sym: 'ETH', label: 'ETH · Ethereum', amt: '0.002' },
  { id: 'route.usdc-base.zec', from: 'USDC@base', sym: 'USDC', label: 'USDC · Base', amt: '3' },
  { id: 'route.usdc-arb.zec', from: 'USDC@arb', sym: 'USDC', label: 'USDC · Arbitrum', amt: '3' },
];

const SAMPLE = {
  zec: 'u1naczqa5m5nefpyqnhs8h3dw8un8z8us45xwgfh4ees95mayyru9snc33dkfk2dc27r5syu4uveyyd5dt8wwad89kpc3f8cah055lm0ex',
  refund: '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e',
};

export function corridorCards(routes, lines = []) {
  const by = new Map(lines.map(l => [l.id, l]));
  const list = (routes || []).slice(0, Math.max(3, (routes || []).length));
  return `<div class="corridors" data-testid="ferry-corridors">${list.map(r => {
    const line = by.get(r.id);
    const usd = line ? (line.usdText || 'USD not quoted') : 'No quote yet';
    return `<article class="corridor" data-testid="ferry-corridor" data-route-id="${esc(r.id)}"><b>${esc(r.label)}</b><p data-testid="ferry-usd">${esc(usd)}</p><p>${esc(line?.text || `${r.sym} ${r.amt}`)}</p></article>`;
  }).join('')}</div>`;
}

function usdOf(line) {
  if (!line) return 'No quote yet';
  if (line.usd == null || line.usd === '') return 'USD not quoted';
  const n = Number(line.usd);
  return `about $${Number.isFinite(n) ? n.toFixed(2) : line.usd}`;
}

export function ferryMarkup(state = {}, routes = DEFAULT_ROUTES) {
  const ri = state.ri || 0;
  const rt = routes[ri] || routes[0];
  const chips = routes.map((r, i) => `<button type="button" class="route-chip" data-route="${esc(r.id)}" aria-pressed="${i === ri ? 'true' : 'false'}" data-testid="ferry-route">${esc(r.label)}${r.down ? ' · down' : ''}</button>`).join('');
  const quotes = (state.quotes || []).map(v => `<p data-testid="ferry-row"${v.best ? ' data-best="1"' : ''}>${esc(v.text || '')}${v.best ? ' · best rate' : ''}</p>`).join('');
  const lines = state.lines || [];
  return `<div class="shop-stack"><div class="route-row" role="group" aria-label="Routes" data-testid="ferry-routes">${chips}</div>
    <label class="amt">Amount <input id="f-amt" type="number" min="0" step="any" value="${esc(state.amt || rt.amt)}"><span id="f-sym">${esc(rt.sym)}</span></label>
    <button type="button" class="primary" id="f-compare" data-testid="ferry-compare">Compare routes</button>
    ${corridorCards(routes, lines)}
    <div id="f-quotes" data-testid="ferry-quotes">${quotes}${state.sample ? '<p data-testid="ferry-sample">The live quote did not return. Nothing was sent.</p>' : ''}</div>
    ${state.fstatus ? `<p data-testid="ferry-status">${esc(state.fstatus.words || state.fstatus.status)}</p><p data-testid="ferry-refund">${state.fstatus.refund ? 'Refunded to the refund address.' : 'A short deposit or a failed swap is refunded to the refund address. This page does not send the deposit.'}</p>` : `<p data-testid="ferry-idle">${state.quoted ? 'No deposit has been requested.' : 'No quote yet. No deposit has been requested.'}</p>`}</div>`;
}

async function quoteOne(route, amount, hooks) {
  if (hooks.quote) return hooks.quote(route.id, amount || route.amt);
  const res = await fetch(api() + '/api/ferry/quote', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: route.from, to: 'ZEC@zec', amount: String(amount || route.amt), recipient: SAMPLE.zec, refundTo: SAMPLE.refund, privacy: 'basic' }),
  });
  return res.json();
}

function mountFerry(root, hooks) {
  const routes = hooks.routes ? hooks.routes() : DEFAULT_ROUTES;
  const state = hooks.state || (hooks.state = {});
  root.innerHTML = ferryMarkup(state, routes);
  const paint = () => { if (hooks.repaint) hooks.repaint(); else root.innerHTML = ferryMarkup(state, routes), bind(); };
  const bind = () => {
    root.querySelectorAll('[data-route]').forEach(btn => {
      btn.onclick = () => {
        state.ri = routes.findIndex(r => r.id === btn.dataset.route);
        state.amt = routes[state.ri]?.amt;
        state.q = null;
        paint();
      };
    });
    const amt = q$(root, '#f-amt');
    if (amt) amt.oninput = (e) => { state.amt = e.target.value; state.amtEdited = true; state.q = null; };
    const compare = q$(root, '#f-compare');
    if (compare) compare.onclick = () => runQuotes(compare);
  };
  async function runQuotes(btn) {
    holdButton(btn, 'Comparing routes. Waiting for the quotes.');
    const raw = [];
    for (const r of routes) {
      try { raw.push(await quoteOne(r, state.amtEdited ? state.amt : r.amt, hooks)); }
      catch { raw.push({ label: r.label, from: { amount: state.amt || r.amt, symbol: r.sym }, to: { symbol: 'ZEC', chain: 'zec' }, dry: true }); }
    }
    const lines = raw.map((q, i) => {
      const line = quoteLine(q) || { text: routes[i].label, usd: null };
      return { id: routes[i].id, text: line.text, usdText: usdOf(line), usd: line.usd, best: false };
    });
    const ranked = pickBest(raw.map(quoteLine).filter(Boolean));
    state.quotes = ranked;
    state.lines = lines.map(l => ({ ...l, best: ranked.find(v => v.text === l.text)?.best }));
    state.sample = !ranked.some(v => v.amountOut != null);
    state.fstatus = null;
    state.quoted = true;
    paint();
  }
  bind();
  if (hooks.auto && !state.quoted) runQuotes(q$(root, '#f-compare'));
}

function mountGuard(root, hooks) {
  const state = hooks.state || (hooks.state = {});
  const attacks = hooks.attacks ? hooks.attacks() : [];
  const score = state.score;
  const scoreHtml = score ? `<div data-testid="guard-score"><p data-testid="guard-verdict">${esc(score.summary || score.verdict)}</p><ul>${(score.lines || []).map(l => `<li data-signal="${esc(l.id)}"${l.level === 'warn' || l.level === 'block' || l.level === 'unknown' ? ' data-testid="guard-reason"' : ''}><b>${esc(l.title)}</b> ${esc(l.text)}</li>`).join('')}</ul></div>` : '<div data-testid="guard-score"></div>';
  const pick = attacks.length ? `<div class="seg beside" role="radiogroup" aria-label="Tricks">${attacks.map(a => `<label class="beside"><input type="radio" name="atk" value="${esc(a.id)}" ${a.id === (state.atk || attacks[0].id) ? 'checked' : ''}><span>${esc(a.name)}</span></label>`).join('')}</div>` : '';
  root.innerHTML = `<div class="shop-stack"><label class="field">Account <input id="g-acct" data-testid="guard-account" value="${esc(state.acct || '')}" autocomplete="off"></label><p class="example-row"><button type="button" class="example" data-testid="guard-example">Example: shop-moved-pay-here.near</button></p><button type="button" class="primary" id="g-check" data-testid="guard-check">Check this account</button>${scoreHtml}${pick}</div>`;
  const example = q$(root, '[data-testid=guard-example]');
  if (example) example.onclick = () => {
    state.acct = 'shop-moved-pay-here.near';
    const input = q$(root, '#g-acct');
    if (input) input.value = state.acct;
  };
  root.querySelectorAll('input[name=atk]').forEach(i => { i.onchange = () => { state.atk = i.value; if (hooks.repaint) hooks.repaint(); }; });
  const btn = q$(root, '#g-check');
  if (!btn) return;
  btn.onclick = async () => {
    const acct = (q$(root, '#g-acct')?.value || '').trim();
    state.acct = acct;
    holdButton(btn, 'Checking this account.');
    try {
      const r = await fetch(api() + '/api/guardhouse/check/' + encodeURIComponent(acct));
      state.score = explainCheck(await r.json());
    } catch (e) {
      state.score = explainCheck({ account: acct, verdict: 'warn', reasons: [{ code: 'account_missing', text: roomError(e) }], signals: {} });
    }
    if (hooks.repaint) hooks.repaint();
    else mountGuard(root, hooks);
  };
}

function mountToll(root) {
  const d = checkDerived({ publicKey: TOLL_KEY, recorded: TOLL_ADDRESS });
  const chains = (d.chains || []).map(c => `<li data-testid="toll-chain">${esc(c.chain)} ${esc(c.path)}${c.address ? ' ' + esc(c.address) : ''} — ${esc(c.note)}</li>`).join('');
  root.innerHTML = `<div class="shop-stack"><div data-testid="toll-derive"><p>${esc(d.text)}</p><ul>${chains}</ul></div><button type="button" class="primary" id="toll-sig" data-testid="check-signature">Check signature</button><p id="toll-sig-out" data-testid="check-signature-out"></p></div>`;
  const b = q$(root, '#toll-sig');
  b.onclick = async () => {
    const out = q$(root, '#toll-sig-out');
    out.textContent = 'Checking the recorded signature…';
    b.disabled = true;
    try {
      const live = await fetch(api() + '/api/mainnet').then(r => r.json());
      const hash = live?.toll?.txs?.owner_toll_pay_allowlisted;
      const sender = live?.toll?.owner || '';
      const st = await fetch(api() + '/api/tx-status/' + encodeURIComponent(hash || '') + '?sender=' + encodeURIComponent(sender)).then(r => r.json());
      out.textContent = st.pass ? 'Pass. The recorded signature is on chain.' : 'Fail. ' + (st.why || 'The chain did not confirm it.');
    } catch { out.textContent = 'Fail. The chain check did not answer.'; }
    b.disabled = false;
  };
}

function mountChronicle(root, hooks) {
  const state = hooks.state || (hooks.state = {});
  const rows = () => {
    const src = hooks.rows ? hooks.rows() : RECORDED;
    return (src || []).map(x => ({ ...x, label: x.label || x.reason || '' }));
  };
  const draw = () => {
    const q = queryFeed(rows(), { q: state.cq || '', decision: state.cd || '', page: state.cp || 1 });
    const ol = q$(root, '[data-testid=chronicle-page]');
    if (ol) {
      ol.innerHTML = q.rows.map(x => `<li class="${x.decision === 'denied' ? 'no' : 'ok'}" data-hash="${esc(x.h || '')}"><span>${esc(x.shop)}</span><span>${x.decision === 'denied' ? '✕ ' + esc(x.label || x.reason || '') : '✓ ' + esc(x.decision)}</span><button type="button" class="c-v" data-hash="${esc(x.h || '')}" data-signer="${esc(x.signer || '')}">Verify</button></li>`).join('') || '<li>Nothing yet</li>';
      ol.dataset.total = String(q.total);
    }
    const pages = q$(root, '[data-testid=chronicle-pages]');
    if (pages) pages.textContent = `${q.page} / ${q.pages}`;
  };
  const verifyHtml = () => `${esc(state.verify || '')}${state.verifyUrl ? ` <a data-testid="chronicle-link" href="${esc(state.verifyUrl)}">explorer</a>` : ''}`;
  root.innerHTML = `<div class="shop-stack"><label class="field">Search <input id="c-q" data-testid="chronicle-search" value="${esc(state.cq || '')}"></label><label class="field">Decision <select id="c-d" data-testid="chronicle-filter"><option value="">All</option><option value="allowed">Allowed</option><option value="denied">Refused</option></select></label><ol class="feed" data-testid="chronicle-page"></ol><p data-testid="chronicle-pages"></p><div class="btns"><button type="button" id="c-prev">Previous</button><button type="button" id="c-next">Next</button><button type="button" id="c-csv" data-testid="chronicle-export">Export</button></div><p id="c-out" data-testid="chronicle-verify">${verifyHtml()}</p></div>`;
  const filter = q$(root, '#c-d');
  if (state.cd) filter.value = state.cd;
  draw();
  q$(root, '#c-q').oninput = (e) => { state.cq = e.target.value; state.cp = 1; draw(); };
  filter.onchange = (e) => { state.cd = e.target.value; state.cp = 1; draw(); };
  q$(root, '#c-prev').onclick = () => { state.cp = Math.max(1, (state.cp || 1) - 1); draw(); };
  q$(root, '#c-next').onclick = () => { state.cp = (state.cp || 1) + 1; draw(); };
  const showVerify = () => {
    const html = verifyHtml();
    const live = root.isConnected ? q$(root, '#c-out') : null;
    if (live) live.innerHTML = html;
    else if (hooks.repaint) hooks.repaint();
  };
  q$(root, '#c-csv').onclick = () => {
    const text = exportCsv(queryFeed(rows(), { q: state.cq || '', decision: state.cd || '', page: 1, pageSize: 100 }).rows);
    downloadCsv(text);
    state.verify = text;
    state.verifyUrl = '';
    showVerify();
  };
  q$(root, '[data-testid=chronicle-page]').addEventListener('click', async (e) => {
    const b = e.target.closest?.('.c-v');
    if (!b) return;
    const row = rows().find(r => r.h === b.dataset.hash) || { h: b.dataset.hash, signer: b.dataset.signer };
    state.verify = 'Checking the chain…';
    state.verifyUrl = '';
    showVerify();
    let chain = null;
    try {
      const res = await fetch(api() + '/api/tx-status/' + encodeURIComponent(row.h) + '?sender=' + encodeURIComponent(row.signer || 'nearcarta.near'));
      chain = await res.json();
    } catch { chain = null; }
    const v = verifyEntry(row, chain);
    state.verify = chain ? v.text : (v.url ? v.text : 'The chain check did not answer.');
    state.verifyUrl = v.url || '';
    showVerify();
  });
}

function mountArena(root, hooks) {
  const state = hooks.state || (hooks.state = {});
  const attack = attackAt();
  if (!state.txt || state.txt === state.attack) state.txt = attack;
  state.attack = attack;
  const goal = hooks.goal ? hooks.goal() : 'Write a scam. The charter still decides.';
  root.innerHTML = `<div class="card shop-card shop-stack"><p class="goal" data-testid="goal">${esc(goal || 'All six walls found')}</p>
    <p class="quote" data-testid="arena-attack">${esc(attack)}</p>
    <textarea id="a-txt" class="attack-box" rows="6" maxlength="160" placeholder="pay 0.001 to stranger.near">${esc(state.txt || '')}</textarea>
    <div class="btns" data-testid="arena-live"><button type="button" class="primary go redteam-run" data-testid="redteam-run">${RUN_LABEL}</button><button type="button" class="primary redteam-next" data-testid="redteam-next">${NEXT_LABEL}</button></div>
    <p class="note">Run it live asks the model and may spend if the charter allows. Another does not spend. This page does not press either for you.</p></div>`;
  const t = q$(root, '#a-txt');
  if (t) t.oninput = (e) => { state.txt = e.target.value; };
  import('../../design/D8_shops/shops/arenalive.js').then(m => m.bindRedteam(() => mountArena(root, hooks))).catch(() => {});
}

function mountPayouts(root, hooks) {
  const state = hooks.state || (hooks.state = {});
  if (!state.rows) state.rows = (hooks.rows ? hooks.rows() : []).filter(r => r && (String(r.to || '').trim() || String(r.amt || '').trim()));
  const drawMsg = () => {
    const issues = payoutIssues(state.rows, state.exists);
    const box = q$(root, '[data-testid=payout-issues]');
    if (!box) return;
    box.textContent = issues.length ? issueText(issues) : 'Each NEAR row needs a real account and at most 0.005 NEAR.';
    box.classList.toggle('bad', issues.length > 0);
  };
  const rowList = () => state.rows.map((r, i) => `<li><label class="field">Payee <input class="p-to" data-i="${i}" data-testid="payout-to" value="${esc(r.to || '')}" autocomplete="off"></label>
        <label class="field">Amount <input class="p-amt" data-i="${i}" data-testid="payout-amt" inputmode="decimal" value="${esc(formatNear(r.amt))}"></label></li>`).join('');
  const bindRows = () => {
    root.querySelectorAll('.p-to').forEach(el => {
      el.oninput = () => { state.rows[+el.dataset.i].to = el.value; drawMsg(); hooks.onReady?.(payoutIssues(state.rows, state.exists).length === 0); };
    });
    root.querySelectorAll('.p-amt').forEach(el => {
      el.oninput = () => { state.rows[+el.dataset.i].amt = el.value; drawMsg(); };
    });
  };
  const render = () => {
    const issues = payoutIssues(state.rows, state.exists);
    const full = state.rows.length >= 3;
    root.innerHTML = `<div class="shop-stack"><p data-testid="payout-issues" class="${issues.length ? 'bad' : ''}">${issues.length ? esc(issueText(issues)) : 'Each NEAR row needs a real account and at most 0.005 NEAR.'}</p>
      <ol class="plist" data-testid="payout-list">${rowList()}</ol>
      <button type="button" class="primary" id="p-add" data-testid="payout-add"${full ? ' disabled data-reason="Three rows is the daily count on this charter."' : ''}>Add a row</button>
      <p data-testid="payout-add-note">${full ? 'Three rows is the daily count on this charter.' : ''}</p>
      <label class="field">CSV <textarea id="p-csv" data-testid="payout-csv" rows="4" placeholder="account,amount,asset">${esc(state.csv || '')}</textarea></label>
      <button type="button" class="primary" id="p-prep" data-testid="payout-prepare">Prepare the batch</button>
      <p data-testid="payout-drop"${state.dropNote ? '' : ' hidden'}>${esc(state.dropNote || '')}</p>
      <ul data-testid="payout-receipts">${(state.receipts || []).map(r => `<li data-testid="payout-receipt">#${r.n} ${esc(r.to)} ${esc(r.amount)} ${esc(r.asset)} · not sent</li>`).join('')}</ul>
      <p data-testid="payout-usdc"${state.usdcNote ? '' : ' hidden'}>${esc(state.usdcNote || '')}</p></div>`;
    bindRows();
    const add = q$(root, '#p-add');
    if (add) add.onclick = () => {
      const next = addPayoutRow(state.rows);
      state.rows = next.rows;
      render();
    };
    const csv = q$(root, '#p-csv');
    csv.oninput = (e) => { state.csv = e.target.value; };
    csv.onchange = () => {
      state.csv = csv.value;
      const parsed = parseCsv(state.csv || '');
      if (!parsed.length) return;
      state.rows = parsed.slice(0, 3);
      const ol = q$(root, '[data-testid=payout-list]');
      if (ol) { ol.innerHTML = rowList(); bindRows(); }
      drawMsg();
    };
    const showDrop = () => {
      const note = q$(root, '[data-testid=payout-drop]');
      if (!note) return;
      note.hidden = !state.dropNote;
      note.textContent = state.dropNote || '';
    };
    q$(root, '#p-prep').onclick = () => {
      const parsed = parseCsv(state.csv || q$(root, '#p-csv')?.value || '');
      const use = parsed.length ? parsed : state.rows;
      const prep = prepareRows(use);
      state.dropNote = prep.note;
      if (prep.blocked) {
        state.receipts = [];
        state.usdcNote = '';
        const box = q$(root, '[data-testid=payout-issues]');
        if (box) { box.textContent = 'Each NEAR row needs a real account and at most 0.005 NEAR.'; box.classList.remove('bad'); }
        const ul = q$(root, '[data-testid=payout-receipts]');
        if (ul) ul.innerHTML = '';
        showDrop();
        return;
      }
      const issues = payoutIssues(prep.rows, state.exists);
      if (issues.length) {
        state.receipts = [];
        const box = q$(root, '[data-testid=payout-issues]');
        if (box) { box.textContent = [prep.note, issueText(issues)].filter(Boolean).join(' '); box.classList.add('bad'); }
        showDrop();
        return;
      }
      const parts = splitAssets(prep.rows);
      state.receipts = receiptsFor(prep.rows);
      state.usdcNote = parts.usdc.length ? `${parts.usdc.length} USDC ${parts.usdc.length === 1 ? 'row' : 'rows'} kept. Not sent. Cap 0.20 USD.` : '';
      if (!root.isConnected && hooks.repaint) { hooks.repaint(); return; }
      const ul = q$(root, '[data-testid=payout-receipts]');
      if (ul) ul.innerHTML = state.receipts.map(r => `<li data-testid="payout-receipt">#${r.n} ${esc(r.to)} ${esc(r.amount)} ${esc(r.asset)} · not sent</li>`).join('');
      const usdc = q$(root, '[data-testid=payout-usdc]');
      if (usdc) { usdc.hidden = !state.usdcNote; usdc.textContent = state.usdcNote; }
      const box = q$(root, '[data-testid=payout-issues]');
      if (box && prep.note) { box.textContent = prep.note; box.classList.remove('bad'); }
      showDrop();
    };
  };
  render();
}

function teePanel(tee, recorded, proof) {
  const view = teeView(tee);
  const steps = view.steps.map(s => `<li data-testid="tee-step" data-ok="${s.ok ? '1' : '0'}"><b>${esc(s.label)}</b> ${s.ok ? 'pass' : esc(s.why || 'did not pass')}</li>`).join('');
  const fail = view.ok ? '' : `<p data-testid="tee-fail">${esc(view.failed)}</p>`;
  return `<div data-testid="tee-panel"><p data-testid="tee-live">${view.ok ? 'Live check passed' : 'Live check did not pass'}</p><p data-testid="tee-result">${esc(view.label)}</p>${fail}<ul data-testid="tee-steps">${steps}</ul>${recorded}${proof}</div>`;
}

function mountBank(root, hooks) {
  const state = hooks.state || (hooks.state = {});
  const who = typeof hooks.visitor === 'function' ? hooks.visitor() : visitor();
  const notes = hooks.notes ? hooks.notes() : [0.001, 0.002, 0.005];
  const named = hooks.payees ? hooks.payees() : [];
  const payees = named.length ? named : (who.signedIn ? [who.accountId] : []);
  const note = notes.includes(+state.amt) ? +state.amt : notes[0];
  const to = state.to || (hooks.def ? hooks.def() : payees[0] || '');
  const tee = state.tee;
  const recorded = `<p class="note tee-recorded" data-testid="tee-recorded">The file <a href="${PROOF_HREF}">tee-public.json</a> is a recorded attestation from Oct 28. The button is the live check.</p>`;
  const proof = `<a data-testid="tee-proof" href="${PROOF_HREF}">Proof file</a>`;
  const panel = tee ? teePanel(tee, recorded, proof) : `<button type="button" class="primary" id="m-tee" data-testid="tee-verify">Verify the TEE now</button>${recorded}${proof}`;
  const sessionLine = who.signedIn ? `<p data-testid="bank-session">Signed in as ${esc(who.displayName || who.accountId)}.</p>` : '';
  const payeeBox = payees.length
    ? payees.map(a => `<label class="payee"><input type="radio" name="mto" value="${esc(a)}" ${a === to ? 'checked' : ''}><span class="payee-id" title="${esc(a)}">${esc(shortId(a))}</span></label>`).join('')
    : '<p>Sign in to choose a payee.</p>';
  root.innerHTML = `<div class="card shop-card shop-stack"><p class="note" data-testid="bank-net">This payment is a charter check on mainnet. ${esc(hooks.proof ? hooks.proof() : '')}</p>
    ${sessionLine}
    <div class="choice" data-testid="bank-amount"><p class="choice-label">Amount</p><div class="seg notes" role="radiogroup" aria-label="Amount" data-testid="bank-notes">${notes.map(n => `<label class="beside"><input type="radio" name="note" value="${n}" ${n === note ? 'checked' : ''}><span>${n} NEAR</span></label>`).join('')}</div></div>
    <div class="choice" data-testid="bank-payee"><p class="choice-label">Payee</p><div class="seg to" id="m-to" data-testid="bank-to">${payeeBox}</div></div>
    ${panel}</div>`;
  root.querySelectorAll('input[name=note]').forEach(r => { r.onchange = () => { state.amt = r.value; hooks.onNote?.(r.value); }; });
  root.querySelectorAll('input[name=mto]').forEach(r => { r.onchange = () => { state.to = r.value; hooks.onTo?.(r.value); }; });
  const b = q$(root, '#m-tee');
  if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    const pg = document.createElement('p');
    pg.className = 'tee-progress';
    pg.dataset.testid = 'tee-progress';
    pg.setAttribute('role', 'status');
    b.after(pg);
    pg.textContent = 'Checking the TEE…';
    try { state.tee = hooks.tee ? await hooks.tee() : await liveTee({ api: api() }); }
    catch (e) { state.tee = { ok: false, err: roomError(e), steps: [{ id: 'request', label: 'NEAR AI attestation', ok: false, why: roomError(e) }] }; }
    mountBank(root, hooks);
  };
}

function mountHouse(root) {
  root.innerHTML = `<div id="house"><p class="note">The town house is on mainnet. This page reads it. It does not hold a key.</p><div class="out">${deedMarkup()}</div></div>`;
  import('/house.bundle.js').then(m => m.mountHouse()).catch((e) => {
    const out = root.querySelector('.out');
    if (!out || out.querySelector('[data-testid=house-state]')) return;
    const note = document.createElement('p');
    note.dataset.testid = 'room-boundary';
    note.setAttribute('role', 'alert');
    note.textContent = /no house/i.test(String(e?.message || e))
      ? 'The house read did not return a row. The deed above is the public record. Nothing was signed.'
      : roomError(e);
    out.appendChild(note);
  });
}

const ALIAS = { guardhouse: 'guard', townhall: 'hall', mist: 'bank', mistbank: 'bank' };

export function mountShop(id, root, hooks = {}) {
  if (!root) return;
  const key = ALIAS[id] || id;
  const fn = {
    ferry: mountFerry,
    guard: mountGuard,
    toll: mountToll,
    chronicle: mountChronicle,
    arena: mountArena,
    payouts: mountPayouts,
    bank: mountBank,
    house: mountHouse,
    hall: (el, h) => import('./hall-ui.js').then(m => m.mountHall(el, h)).catch(e => { el.innerHTML = boundaryHtml(e); }),
  }[key];
  try {
    if (!fn) { root.innerHTML = boundaryHtml(new Error('This shop is not on the page.')); return; }
    return fn(root, hooks);
  } catch (e) {
    root.innerHTML = boundaryHtml(e);
  }
}
