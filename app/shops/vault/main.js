// Charter shop + Vault Arena. Wallet signs owner steps; the agent key made here signs `propose`.
import { makeConnector, currentAccount, txHashOf, hasGuest, forgetGuest } from './wallet.js';
import { rpcClient, viewFn, keyFrom, sendPropose } from '../../../shared/vault/tx.js';
import { keyPlan, keyToAdd } from '../../../shared/vault/agentkeys.js';
import { runSteps, runTask, runAsk } from '../../../shared/vault/run.js';
import { parseAsk } from '../../../shared/vault/ask.js';
import { lookalike } from '../../../shared/vault/attacks.js';

const API = (window.NEARCARTA_API || '').replace(/\/$/, '');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const YN = 10n ** 24n, TG = 10n ** 12n;
const toY = n => (BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n).toString();
const fmt = y => { if (y == null) return '–'; const v = Number(BigInt(y) / 10n ** 18n) / 1e6; return (v < 0.01 && v > 0 ? v.toFixed(3) : +v.toFixed(4)) + ' NEAR'; };
const short = h => h ? h.slice(0, 6) + '…' + h.slice(-4) : '';
let lastRules = null;
let CFG, rpc, connector, me = null, charter = null, ready = false, target = 'shared';

async function api(path, opts) {
  const r = await fetch(API + path, opts); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'http ' + r.status); return j;
}
const view = (c, m, a) => viewFn(rpc, c, m, a);
const txl = (h, label) => h ? `<a class="tx" data-testid="tx" href="${esc(CFG.explorer || 'https://testnet.nearblocks.io')}/txns/${esc(h)}" target="_blank" rel="noopener">${esc(label || short(h))}<span aria-hidden="true">↗</span></a>` : '';
const agentLS = c => 'nearcarta.vault.agent.' + c;
// A key made for a wallet approval that has not shown up on chain yet. Saved BEFORE signing so a
// redirect wallet or a closed tab never leaves a live key on chain that nobody holds.
const pendLS = c => 'nearcarta.vault.agent.pending.' + c;
const NS = 1_000_000_000n;
const dur = ns => { const s = Number(BigInt(ns || 0) / NS); if (!s) return 'none'; if (s % 86400 === 0) return s / 86400 + (s === 86400 ? ' day' : ' days');
  if (s % 3600 === 0) return s / 3600 + (s === 3600 ? ' hour' : ' hours'); return Math.round(s / 60) + ' min'; };
const when = ns => new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleString();
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function toast(html, kind = 'info') { const t = $('#log'); const li = document.createElement('li'); li.className = kind; li.innerHTML = html; t.prepend(li); }
function busy(btn, on, label) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Waiting for chain…'; } else if (btn.dataset.l) btn.textContent = btn.dataset.l; }
const fail = e => toast(`<b>Stopped:</b> ${esc(e.message)}${e.tx ? ' · ' + txl(e.tx) : ''}`, 'bad err');

// ---------- step 1: wallet ----------
async function refreshWho() {
  me = await currentAccount(connector);
  $('#who').innerHTML = me ? `<b data-testid="who">${esc(me)}</b>` : '';
  $('#connect').hidden = !!me; $('#guest').hidden = !!me; $('#signout').hidden = !me;
  document.body.dataset.step = me ? (charter ? 'charter' : 'wallet') : 'none';
  if (me && !charter) {
    const mine = await view(CFG.factory, 'charters_of', { owner: me }).catch(() => []);
    if (mine.length) await useCharter(mine[mine.length - 1]);
  }
  renderCreate();
}

// ---------- step 2: create ----------
function renderCreate() {
  const box = $('#create');
  if (!me) { box.innerHTML = '<p class="muted" title="A charter is a NEAR account that holds your agent\'s money and its rules.">Start free first.</p>'; focusCreate(); return; }
  if (charter) { box.innerHTML = `<p>Your charter: <b data-testid="charter-id">${esc(charter)}</b></p>`; return; }
  const base = me.split('.')[0].replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'my';
  box.innerHTML = `<label>Name <span class="suffix"><input id="cname" value="${esc(base)}" maxlength="32" pattern="[a-z0-9-]+" aria-describedby="cname-h"><span>.${esc(CFG.factory)}</span></span></label>
    <label>Deposit <span class="suffix"><input id="cdep" type="number" min="0.3" max="5" step="0.1" value="0.5"><span>NEAR</span></span></label>
    <label>Timelock <select id="cdelay" data-testid="delay">${delayOptions()}</select></label>
    <label>DAO (optional) <input id="cdao" placeholder="e.g. mydao.sputnik-dao.near" maxlength="64" data-testid="dao"></label>
    <details class="how"><summary>How this works</summary><p class="muted">After setup, a wider allowlist, a bigger cap or a new agent key waits this long before it applies, and the owner (or the DAO) can cancel it meanwhile. Tightening is always instant. The DAO can also freeze the charter or cancel changes.</p>
    <p id="cname-h" class="muted">The factory creates the account, points it at the audited oath code (by hash, nothing is uploaded), and makes you the owner. It keeps 0.01 NEAR as a fee.</p></details>
    <button id="create-btn" class="primary" data-testid="create">Create my charter</button>`;
  $('#create-btn').onclick = () => createCharter().catch(fail).finally(() => busy($('#create-btn'), false));
  focusCreate();
}
// The town sends new owners to /shops/vault/#create: bring the next step into view and focus it.
function focusCreate() {
  if (location.hash !== '#create') return;
  const el = $('#create-btn') || (!me && $('#guest'));
  if (!el || el.hidden) return;
  el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true });
}
// Tells the rest of the town (and anything listening) that a wallet just signed in.
const signedIn = () => currentAccount(connector).then(a => a && window.dispatchEvent(new CustomEvent('nearcarta:signin', { detail: { accountId: a } })));
function delayOptions() {
  const pd = CFG.policy_delay || {}; const min = BigInt(pd.min_ns || 600n * NS), max = BigInt(pd.max_ns || 30n * 86400n * NS), def = BigInt(pd.default_ns || 86400n * NS);
  return [600n, 3600n, 21600n, 86400n, 604800n].map(s => s * NS).filter(ns => ns >= min && ns <= max)
    .map(ns => `<option value="${ns}"${ns === def ? ' selected' : ''}>${dur(ns)}${ns === def ? ' (default)' : ''}</option>`).join('');
}
async function createCharter() {
  const name = $('#cname').value.trim().toLowerCase(), dep = Number($('#cdep').value);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error('name: a-z, 0-9 and single dashes');
  if (!(dep >= 0.3 && dep <= 5)) throw new Error('deposit must be 0.3 to 5 NEAR');
  const dao = $('#cdao').value.trim().toLowerCase();
  if (dao && !/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(dao)) throw new Error('DAO: a NEAR account id');
  const args = { name, policy_delay_ns: $('#cdelay').value, ...(dao ? { dao } : {}) };
  busy($('#create-btn'), true, 'Approve in your wallet…');
  const w = await connector.wallet();
  const res = await w.signAndSendTransaction({ receiverId: CFG.factory, actions: [{ type: 'FunctionCall', params: { methodName: 'create_charter', args, gas: (150n * TG).toString(), deposit: toY(dep) } }] });
  const h = txHashOf(res); const id = `${name}.${CFG.factory}`; noteSent(h, id);
  const f = await facts(id, f => f.registered && f.exists && !f.pending);
  if (!f.registered) throw Object.assign(new Error('charter not created (name taken? the deposit was refunded minus gas)'), { tx: h });
  toast(`Charter created · ${txl(h)}`, 'good'); await useCharter(id);
}

// ---------- step 3: rules + agent key ----------
async function useCharter(id) { charter = id; document.body.dataset.step = 'charter'; renderCreate(); await renderFacts(); if (ready) setTarget('mine'); loadScore('mine').catch(() => {}); }
// Fresh charter facts; retried while RPC nodes catch up with a tx that just landed.
async function facts(id, ready = f => !f.pending, tries = 20) {
  let f = null;
  for (let i = 0; i < tries; i++) {
    f = await api('/api/vault/charter/' + id + '?fresh=1').catch(() => null);
    if (f && ready(f)) return f;
    await new Promise(r => setTimeout(r, 1500));
  }
  if (!f) throw new Error('could not read the charter from chain, try again');
  return f;
}
async function renderFacts() {
  const f = await facts(charter);
  const cl = f.clauses?.pay; const u = f.usage?.pay; lastRules = cl;
  const onChain = (f.agent_keys || []).map(a => a.public_key);
  const queued = Object.entries(f.pending_changes || {});
  const queuedPks = queued.map(([, p]) => p.change?.SetAgentKey?.public_key).filter(Boolean);
  const pend = localStorage.getItem(pendLS(charter)); const pendPk = pend ? keyFrom(pend).publicKey : null;
  const held = localStorage.getItem(agentLS(charter)); const heldPk = held ? keyFrom(held).publicKey : null;
  const kp = keyPlan({ onChain, current: f.state?.agent_key ?? null, held: heldPk, pend: pendPk, queued: queuedPks });
  // Promote a pending key once the chain shows it; keep it while its change waits in the timelock.
  if (kp.promote) { localStorage.setItem(agentLS(charter), pend); localStorage.removeItem(pendLS(charter)); }
  const { keyLive, pendWaiting, pendLost, revocable: orphans, stray } = kp;
  $('#facts').innerHTML = `<details class="how facts-box"><summary>Charter facts</summary><ul class="facts" data-testid="facts">
    <li class="${f.runs_r14 ? 'ok' : 'no'}">Runs the audited oath code <code title="${esc(CFG.code_hash)}">${esc(short(CFG.code_hash))}</code></li>
    <li class="${f.full_access_keys === 0 ? 'ok' : 'no'}">${f.full_access_keys} full-access keys (nobody can bypass the rules)</li>
    <li class="${f.owner === me ? 'ok' : 'no'}">Owner: ${esc(f.owner)}</li>
    <li class="${BigInt(f.policy_delay_ns || 0) > 0n ? 'ok' : 'no'}" data-testid="timelock">Timelock: loosening the rules waits ${esc(dur(f.policy_delay_ns))}</li>
    <li class="${f.dao ? 'ok' : ''}">Co-guardian DAO: ${f.dao ? `<code>${esc(f.dao)}</code>` : 'none'}</li>
    <li class="${f.setup_open ? 'todo' : 'ok'}" data-testid="setup">${f.setup_open ? 'Setup window open: the first rules and agent key apply at once. Adding the agent key closes it.' : 'Setup closed: loosening rules or a new agent key now waits the timelock'}</li>
    <li>Balance: ${fmt(f.balance)}</li>
    <li class="${cl ? 'ok' : 'todo'}">${cl ? `Rules: pays only ${cl.receivers.map(esc).join(', ')} · max ${fmt(cl.per_action_cap)} each · ${fmt(cl.daily_budget)} a day · ${cl.max_actions_per_day || '∞'} payments a day` : 'No rules yet'}</li>
    ${u ? `<li>Today: spent ${fmt(u.spent)} in ${u.count} payments</li>` : ''}
    <li class="${keyLive ? 'ok' : 'todo'}" data-testid="agent-key">${keyLive ? `Agent key in this browser, can only call <code>propose</code>` : pendWaiting ? 'New agent key made in this browser, waiting for its timelock' : 'No agent key in this browser yet'}</li></ul></details>
    ${queued.length ? `<h3>Waiting in the timelock</h3><ul class="facts" data-testid="pending">${queued.map(([id, p]) => {
      const ready = Date.now() * 1e6 >= Number(p.eta); const kind = Object.keys(p.change || {})[0] || 'change';
      return `<li class="todo"><b>${esc(kind)}</b> #${esc(id)} · by ${esc(p.by)} · ${ready ? 'ready now' : 'ready ' + esc(when(p.eta))}
        <button class="mini" data-exec="${esc(id)}" ${ready ? '' : 'disabled'}>Apply</button> <button class="mini" data-cancel="${esc(id)}">Cancel</button></li>`; }).join('')}</ul>` : ''}
    ${pendLost ? `<p class="verdict bad" data-testid="pend-lost">A key made in this browser for an earlier approval never reached the chain. <button class="mini" id="forget-pend">Forget it</button></p>` : ''}
    ${orphans.length ? `<p class="verdict bad" data-testid="orphans">The charter's agent key <code>${esc(short(orphans[0]))}</code> is not held by this browser. Revoke it so a lost key cannot spend its allowance, then issue a new one. <button class="mini" id="revoke">Revoke</button></p>` : ''}
    ${stray.length ? `<p class="muted" data-testid="stray">Other function-call keys on this account, not the charter's agent key: ${stray.map(x => `<code>${esc(short(x))}</code>`).join(' ')}.</p>` : ''}`;
  { const fb = $('#facts .facts-box'); if (fb && fb.querySelector('li:not(.ok)')) fb.open = true; } // checklist stays open until every fact is green
  for (const b of $('#facts').querySelectorAll('[data-exec]')) b.onclick = () => ownerCall('execute_change', { change_id: b.dataset.exec }, b, 'Change applied').catch(fail);
  for (const b of $('#facts').querySelectorAll('[data-cancel]')) b.onclick = () => ownerCall('cancel_change', { change_id: b.dataset.cancel }, b, 'Change cancelled').catch(fail);
  if ($('#forget-pend')) $('#forget-pend').onclick = () => { localStorage.removeItem(pendLS(charter)); renderFacts().catch(fail); };
  if ($('#revoke')) $('#revoke').onclick = () => ownerCall('revoke_agent', {}, $('#revoke'), 'Agent key revoked').catch(fail);
  renderRules(cl, keyLive || pendWaiting, f);
  const was = ready; ready = !!(cl && keyLive);
  $('#mine').hidden = !ready;
  renderDash(f, cl, u);
  if (was !== ready) setTarget(target); // only when the target list changes: a rerender mid-run would wipe the result
}
// ---------- dashboard: today's use against the rules, and the freeze switch ----------
const pct = (a, b) => b > 0n ? Math.min(100, Number((a * 100n) / b)) : 0;
const gauge = (label, used, max, show, testid) => { const p = pct(used, max);
  return `<div class="gauge" data-testid="${testid}"><div class="gl"><span>${esc(label)}</span><b>${show}</b></div><div class="bar ${p >= 100 ? 'full' : p >= 75 ? 'hot' : ''}"><span style="width:${p}%"></span></div></div>`; };
// Time left: the oath's daily counters reset at 00:00 UTC. Rule expiry: valid_until from /api/charter/<id>/rules/pay
// (R16 set_clause_expiry). Charters on R15 code answer supported:false, so the gauge says "No expiry" and that is true.
const nextReset = () => (Math.floor(Date.now() / 86400000) + 1) * 86400000;
const dayPct = () => Math.round(((Date.now() % 86400000) / 86400000) * 100);
const left = ms => { if (ms <= 0) return 'now'; const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m % 60} min`; };
let expiry = { ms: null, known: false };
const expiryText = () => !expiry.known ? '…' : expiry.ms == null ? 'No expiry' : expiry.ms <= Date.now() ? 'Expired' : 'in ' + left(expiry.ms - Date.now());
const expiryBar = () => expiry.ms == null ? '' : `<div class="bar ${expiry.ms - Date.now() < 3600e3 ? 'hot' : ''}"><span id="exp-bar" style="width:${Math.max(0, Math.min(100, Math.round((expiry.ms - Date.now()) / 25920000)))}%"></span></div>`;
async function loadExpiry() {
  const r = await api(`/api/charter/${charter}/rules/pay`).catch(() => null);
  if (!r) return; // busy RPC: keep the last answer
  expiry = { known: true, ms: r.supported && r.valid_until ? Number(BigInt(r.valid_until) / 1_000_000n) : null };
  const b = $('#exp-left'); if (b) { b.textContent = expiryText(); b.closest('.gauge').querySelector('.bar')?.remove(); b.closest('.gauge').insertAdjacentHTML('beforeend', expiryBar()); }
}
setInterval(() => { const a = $('#reset-left'); if (a) { a.textContent = left(nextReset() - Date.now()); $('#reset-bar').style.width = dayPct() + '%'; }
  const e = $('#exp-left'); if (e && expiry.known) e.textContent = expiryText(); }, 30000);
function renderDash(f, cl, u) {
  $('#dash').hidden = !cl;
  if (!cl) return;
  loadExpiry(); loadFeed();
  $('#dash-id').textContent = charter;
  const today = u && Number(u.day) === Math.floor(Date.now() / 86400000); // usage resets at 00:00 UTC
  const frozen = !!f.state?.frozen;
  const spent = BigInt(today ? u.spent : 0), bud = BigInt(cl.daily_budget), cnt = BigInt(today ? u.count : 0), max = BigInt(cl.max_actions_per_day || 0);
  const canUnfreeze = !f.dao || f.dao === me;
  $('#gauges').innerHTML = `<div class="gauges">
    ${gauge('Spent today', spent, bud, `${fmt(spent)} / ${fmt(bud)}`, 'gauge-spent')}
    ${max ? gauge('Payments today', cnt, max, `${cnt} of ${max}`, 'gauge-count') : ''}
    <div class="gauge" data-testid="gauge-reset"><div class="gl"><span>Limits reset in</span><b id="reset-left">${left(nextReset() - Date.now())}</b></div><div class="bar day"><span id="reset-bar" style="width:${dayPct()}%"></span></div></div>
    <div class="gauge" data-testid="gauge-expiry"><div class="gl"><span>Rules expire</span><b id="exp-left">${expiryText()}</b></div>${expiryBar()}</div>
    <div class="gauge"><div class="gl"><span>Max per payment</span><b>${fmt(cl.per_action_cap)}</b></div><div class="gl"><span>Balance</span><b>${fmt(f.balance)}</b></div></div>
    <div class="gauge freeze ${frozen ? 'on' : ''}"><div class="gl"><span>Status</span><b data-testid="frozen">${frozen ? 'FROZEN · all refused' : 'Active'}</b></div>
      ${frozen ? `<button id="unfreeze" data-testid="unfreeze" ${canUnfreeze ? '' : 'disabled title="Only the DAO can unfreeze this charter"'}>Unfreeze</button>`
        : `<button id="freeze" class="danger" data-testid="freeze" title="Stops the agent at once. Instant, one wallet approval.">Freeze the agent</button>`}</div></div>
    ${f.dao ? '<p class="muted">Only the DAO can undo a freeze.</p>' : ''}`;
  if ($('#freeze')) $('#freeze').onclick = () => ownerCall('freeze', {}, $('#freeze'), 'Charter frozen').then(() => tell('Frozen. Every payment is now refused on chain.', 'info')).catch(fail);
  if ($('#unfreeze')) $('#unfreeze').onclick = () => ownerCall('unfreeze', {}, $('#unfreeze'), 'Charter unfrozen').catch(fail);
}
async function ownerCall(methodName, args, btn, done) {
  busy(btn, true, 'Approve in your wallet…');
  try {
    const w = await connector.wallet();
    const res = await w.signAndSendTransaction({ receiverId: charter, actions: [{ type: 'FunctionCall', params: { methodName, args, gas: (60n * TG).toString(), deposit: '0' } }] });
    noteSent(txHashOf(res)); toast(`${esc(done)} · ${txl(txHashOf(res))}`, 'good');
  } finally { busy(btn, false); }
  await renderFacts();
}
// Rule expiry can be tightened at once, but extending it is a loosening change, so it waits the charter's timelock.
// The factory default (24 h on R16, from /api/vault/config) is named unless this charter chose another delay.
const hrs = ns => { const m = Number(BigInt(ns) / NS / 60n); return m % 60 ? m + ' min' : m / 60 + ' h'; };
function expiryHint(f) {
  const def = BigInt(CFG.policy_delay?.default_ns || 86400n * NS), own = f.policy_delay_ns ? BigInt(f.policy_delay_ns) : def;
  return `Extending waits for your timelock (${own === def ? 'default ' + hrs(def) : hrs(own)}); renew at least a day early.`;
}
function renderRules(cl, keyLive, f = {}) {
  const m = CFG.arena.merchants;
  $('#rules').innerHTML = `<div class="grid2">
    <label>Allowed payee 1<input id="r1" value="${esc(cl?.receivers?.[0] || m[0])}"></label>
    <label>Allowed payee 2<input id="r2" value="${esc(cl?.receivers?.[1] || m[1])}"></label>
    <label>Max per payment<span class="suffix"><input id="rcap" type="number" step="0.01" min="0.002" value="${cl ? Number(BigInt(cl.per_action_cap) / 10n ** 18n) / 1e6 : 0.05}"><span>NEAR</span></span></label>
    <label>Daily budget<span class="suffix"><input id="rbud" type="number" step="0.01" min="0.002" value="${cl ? Number(BigInt(cl.daily_budget) / 10n ** 18n) / 1e6 : 0.1}"><span>NEAR</span></span></label>
    <label>Payments per day<input id="rmax" type="number" min="1" max="50" value="${cl?.max_actions_per_day || 4}"></label>
    <label>Smallest payment<span class="suffix"><input id="rmin" type="number" step="0.001" min="0.001" value="0.001"><span>NEAR</span></span></label>
    ${f.legacy ? '' : `<label>Rules expire<select id="rexp" data-testid="rexp"><option value="">Keep as is</option><option value="1">In 1 day</option><option value="7"${cl ? '' : ' selected'}>In 7 days</option><option value="30">In 30 days</option></select></label>
    <p class="hint" data-testid="rexp-hint">${expiryHint(f)}</p>`}</div>
    <details class="how"><summary>How this works</summary><p class="muted">One wallet approval does two things: saves these rules on chain and adds a fresh agent key made in this browser. That key can only call <code>propose</code> on this charter; it cannot move money around the rules.${f.setup_open === false ? ' Setup is closed, so a looser rule or a new key waits the timelock; a tighter rule applies at once.' : ''}</p></details>
    <button id="rules-btn" class="primary" data-testid="rules">${cl && keyLive ? 'Update rules' : 'Save rules and issue agent key'}</button>`;
  $('#rules-btn').onclick = () => saveRules(keyLive).catch(fail).finally(() => busy($('#rules-btn'), false));
}
async function saveRules(keyLive) {
  const rec = [$('#r1').value.trim(), $('#r2').value.trim()].filter(Boolean);
  const clause = { asset: 'Native', receivers: rec, per_action_cap: toY($('#rcap').value), daily_budget: toY($('#rbud').value),
    window_start_min: 0, window_end_min: 0, requires_receipt: false, escalation_max: null, min_amount: toY($('#rmin').value), max_actions_per_day: Number($('#rmax').value) };
  if (BigInt(clause.per_action_cap) > BigInt(clause.daily_budget)) throw new Error('max per payment is above the daily budget');
  const actions = [{ type: 'FunctionCall', params: { methodName: 'set_clause', args: { clause_id: 'pay', clause }, gas: (40n * TG).toString(), deposit: '0' } }];
  const days = Number($('#rexp')?.value || 0);
  if (days) actions.push({ type: 'FunctionCall', params: { methodName: 'set_clause_expiry', args: { clause_id: 'pay', expires_at: String(BigInt(Date.now() + days * 864e5) * 1_000_000n) }, gas: (30n * TG).toString(), deposit: '0' } });
  if (!keyLive) { const k = keyToAdd(localStorage.getItem(pendLS(charter)), () => keyFrom().secretKey); // reuse a pending key: its approval may still land
    localStorage.setItem(pendLS(charter), k); // before signing: a redirect wallet must not lose it
    actions.push({ type: 'FunctionCall', params: { methodName: 'set_agent_key', args: { public_key: keyFrom(k).publicKey, allowance: (YN / 2n).toString() }, gas: (60n * TG).toString(), deposit: '0' } }); }
  busy($('#rules-btn'), true, 'Approve in your wallet…');
  const w = await connector.wallet();
  const res = await w.signAndSendTransaction({ receiverId: charter, actions });
  noteSent(txHashOf(res)); toast(`Rules sent${keyLive ? '' : ' with a new agent key'} · ${txl(txHashOf(res))}`, 'good');
  await renderFacts();
  const f = await facts(charter);
  if (Object.keys(f.pending_changes || {}).length) toast('Some changes loosen the rules, so they wait in the timelock. Apply or cancel them in step 2.', 'info');
  if (!f.setup_open) tell('Your rules are live. Ask the agent to pay (top of this tab) or try to trick it in the Arena.', 'info');
}

// ---------- "What happened": a plain story of every payment the agent tried in this tab ----------
const WHY = { clause_expired: 'the rules expired', receiver_not_allowlisted: 'payee not on your allowlist', over_per_action_cap: 'over the max per payment', over_daily_budget: "over today's budget",
  over_daily_action_count: 'over the payments-per-day limit', below_min_amount: 'below the smallest payment', frozen: 'the charter is frozen', expired: 'the request expired',
  stale_policy_version: 'the rules changed meanwhile', outside_time_window: 'outside the allowed hours' };
const plain = r => WHY[r] || String(r || 'failed').replace(/_/g, ' ');
// The feed is read back from chain (/api/chronicle/<charter>: tx index + RPC), so it survives a reload and shows
// what other tabs or the agent did too. Each line is one transaction; the hash sits behind "details".
const ago = iso => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'; };
const nm = a => String(a || '').split('.')[0];
function feedLine(t) {
  const act = (t.events || []).find(e => e.event === 'action')?.data?.[0];
  if (t.method === 'propose' && act) return act.decision === 'allowed'
    ? { k: 'good', d: 'allowed', h: `Paid <b>${fmt(act.amount)}</b> to ${esc(nm(act.receiver))}` }
    : { k: 'bad', d: 'denied', r: act.reason, h: `Refused ${fmt(act.amount)} to ${esc(nm(act.receiver))}: ${esc(plain(act.reason))}` };
  const L = { freeze: ['bad', 'You froze the charter'], unfreeze: ['good', 'You unfroze the charter'], set_clause: ['', 'Rules saved'], set_agent_key: ['', 'Agent key added'],
    revoke_agent: ['', 'Agent key revoked'], execute_change: ['', 'Waiting change applied'], cancel_change: ['', 'Waiting change cancelled'], set_clause_expiry: ['', 'Rule expiry set'], create_charter: ['', 'Charter created'] }[t.method];
  if (L) return { k: L[0], h: L[1] };
  if (t.error || !t.method) return null;
  const m = String(t.method).replace(/_/g, ' '); return { k: '', h: esc(m[0].toUpperCase() + m.slice(1)) };
}
// The tx index can lag a fresh tx by a few seconds: after this tab sends a tx on its own charter, the chain feed
// takes over the story only once it lists that tx (polled up to 5 times), so it never shows an older picture.
// This tab's own tx hashes per charter (session only): sent as `known` so the server can re-read them from RPC
// when the tx index lags or is busy; the server keeps only txs that really belong to the charter.
function noteSent(h, id = charter) {
  if (!h || !id) return;
  try { const k = 'nc-sent:' + id, a = JSON.parse(sessionStorage.getItem(k) || '[]').filter(x => x !== h); a.push(h); sessionStorage.setItem(k, JSON.stringify(a.slice(-12))); } catch { /* private mode */ }
}
const sentList = () => { try { return JSON.parse(sessionStorage.getItem('nc-sent:' + charter) || '[]'); } catch { return []; } };
let feedBusy = null, want = null, misses = 0, busyLeft = 12;
function loadFeed() {
  if (!charter || feedBusy) return feedBusy;
  feedBusy = (async () => {
    let j = null;
    const known = sentList().join(',');
    for (let i = 0; i < 3 && !j; i++) { j = await api(`/api/chronicle/${charter}?limit=12${known ? '&known=' + known : ''}`).catch(e => (/not a Nearcarta/.test(e.message) ? 'no' : null)); if (j?.busy) j = null; if (!j) await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
    if (!j && busyLeft-- > 0) { setTimeout(loadFeed, 5000); return; } // index busy: keep this tab's story, ask again shortly
    if (!j || j === 'no') return; // API without the charter feed yet
    if (want && !(j.txs || []).some(t => t.hash === want)) { if (++misses < 5) setTimeout(loadFeed, 3000); return; }
    const rows = (j.txs || []).map(t => ({ t, l: feedLine(t) })).filter(x => x.l);
    if (!rows.length) return;
    const ok = rows.filter(x => x.l.d === 'allowed'), no = rows.filter(x => x.l.d === 'denied');
    const paid = ok.reduce((a, x) => a + BigInt((x.t.events.find(e => e.event === 'action').data[0].amount) || 0), 0n);
    $('#story').innerHTML = ok.length + no.length ? `<b>${ok.length} allowed</b> (${fmt(paid)} paid) · <b>${no.length} refused</b> · last ${rows.length} transactions`
      : `${rows.length} transactions on chain, no payments yet`;
    $('#feed').innerHTML = rows.map(({ t, l }) => `<li class="${l.k}" data-testid="feed-row"><span>${l.h}</span><span class="when">${esc(ago(t.at))}</span>${t.hash ? `<a class="tx" href="${esc(t.url)}" target="_blank" rel="noopener" title="${esc(t.hash)}">details<span aria-hidden="true">↗</span></a>` : ''}</li>`).join('');
    $('#feed').hidden = false; $('#story').dataset.src = 'chain';
  })().finally(() => { feedBusy = null; });
  return feedBusy;
}
const tries = [];
function tell(html, kind) { toast(html, kind); }
function record(s, who) {
  if (!s || !s.decision) return;
  tries.push({ ...s, who });
  if (s.tx && !/^Shared/.test(who)) { want = s.tx; misses = 0; noteSent(s.tx); $('#story').dataset.src = ''; }
  const ok = tries.filter(t => t.decision === 'allowed'), no = tries.filter(t => t.decision !== 'allowed');
  const total = ok.reduce((a, t) => a + BigInt(t.amount || 0), 0n);
  const reasons = Object.entries(no.reduce((m, t) => (m[plain(t.reason)] = (m[plain(t.reason)] || 0) + 1, m), {})).map(([r, n]) => `${n} ${r}`).join(', ');
  if ($('#story').dataset.src !== 'chain') $('#story').innerHTML = `Your agent tried <b>${tries.length}</b> payment${tries.length > 1 ? 's' : ''}: <b>${ok.length} allowed</b>${ok.length ? ` (${fmt(total)} paid)` : ''}, <b>${no.length} refused</b>${no.length ? ': ' + esc(reasons) : ''}.`;
  setTimeout(loadFeed, 2500);
  toast(`${esc(who)}: ${fmt(s.amount)} to <code>${esc(s.receiver)}</code> · <b>${s.decision === 'allowed' ? 'allowed' : 'refused: ' + esc(plain(s.reason))}</b> · ${txl(s.tx)}`, s.decision === 'allowed' ? 'good' : 'bad');
}

// ---------- ask the agent to pay ----------
function quickCards() {
  $('#mine .tsks').innerHTML = CFG.tasks.map(t => `<button class="atk tsk" data-where="mine" data-task="${esc(t.id)}" data-testid="task-mine-${esc(t.id)}">
    <b>${esc(t.name)}</b><em class="ok">allowed</em></button>`).join('');
  for (const b of $('#mine .tsks').querySelectorAll('.tsk')) b.onclick = () => task(b).catch(fail).finally(unlock);
}
// Who proposed the payment: the NEAR AI model in a TEE (signature checked by our server) or the labelled plain-words fallback.
function brainLine(b) {
  if (!b) return '';
  if (b.by !== 'model') return `<p class="muted" data-testid="brain">Proposed by the plain-words fallback parser, not the AI model${b.fallback_why ? ' (' + esc(b.fallback_why) + ')' : ''}. The charter still decides.</p>`;
  const v = b.verification || {}, ok = v.verified ? 'signature verified' : 'signature NOT verified';
  const flag = b.parsed?.suspicious ? ` It flagged this as suspicious: ${esc(b.parsed.why || '')}.` : '';
  return `<p class="muted" data-testid="brain">Proposed by NEAR AI model <code>${esc(b.model || '')}</code> in a TEE · ${ok}${v.signing_address ? ' by <code>' + esc(v.signing_address.slice(0, 10)) + '…</code>' : ''}.${flag} The model only proposes; the charter decides.</p>`;
}
async function ask(e) {
  e.preventDefault();
  const out = $('#mine .result'); const btn = $('#ask-btn');
  const text = $('#ask-text').value;
  let q, brain = null;
  busy(btn, true, 'NEAR AI model is reading…');
  try {
    brain = await post('/api/vault/ask/plan', { text, charter });
    q = brain.parsed;
  } catch (er) { brain = { by: 'fallback', fallback_why: 'model route failed: ' + er.message }; }
  finally { busy(btn, false); }
  if (!q) {
    try { q = parseAsk(text, CFG.arena.merchants.concat(lastRules?.receivers || []), 'mine'); }
    catch (er) { out.innerHTML = `<p class="verdict bad" data-testid="verdict">${esc(er.message)}</p>`; return; }
  }
  lock(); busy(btn, true, 'Agent is paying…');
  out.innerHTML = brainLine(brain) + `<p class="muted">Your agent proposes ${fmt(q.amount)} to <code>${esc(q.receiver)}</code>${q.note ? ' for ' + esc(q.note) : ''}. Waiting for the charter's decision on chain…</p><ol class="steps"></ol>`;
  try {
    const r = await runAsk({ charter, key: keyFrom(localStorage.getItem(agentLS(charter))), receiver: q.receiver, amount: q.amount, memo: q.memo, rpcCall: rpc, viewF: view, send: sendPropose });
    out.querySelector('.steps').innerHTML = stepRow(r, 1, 1); record(r, 'You asked');
    out.insertAdjacentHTML('beforeend', r.passed
      ? `<p class="verdict good" data-testid="verdict">ALLOWED: the charter paid ${fmt(r.amount)} to <code>${esc(r.receiver)}</code>. ${txl(r.tx, 'see the transaction')}</p>`
      : `<p class="verdict bad" data-testid="verdict">REFUSED: ${esc(plain(r.reason))}. Nothing was paid. ${txl(r.tx, 'see the refusal')}</p>`);
    out.insertAdjacentHTML('beforeend', '<p class="muted">One allowed request to a shop on your allowlist, within your max per payment, scores a point (once). The charter decides, not this page.</p>');
    // the verdict is in: free the button now; the scoreboard write and the refresh follow in the background
    busy(btn, false); unlock();
    (r.tx ? post('/api/vault/record', { tx: r.tx, charter }).catch(e => toast('Scoreboard did not take it: ' + esc(e.message), 'bad')) : Promise.resolve())
      .then(() => { renderFacts().catch(() => {}); loadScore('mine').catch(() => {}); });
  } finally { busy(btn, false); unlock(); }
}

// ---------- arena: one grid, two targets ----------
function setTarget(t) {
  target = t === 'mine' && ready ? 'mine' : 'shared';
  const r = document.querySelector(`input[name=target][value=${target}]`); if (r) r.checked = true;
  $('input[name=target][value=mine]').disabled = !ready;
  $('#t-mine-note').textContent = ''; $('input[name=target][value=mine]').closest('label').title = ready ? charter : 'Make a charter and an agent key first';
  $('#nick-box').hidden = target !== 'shared';
  $('#runner').hidden = target !== 'shared';
  $('#target-help').textContent = target === 'shared' && !CFG.attack_enabled ? 'The shared runner is off on this deployment.' : '';
  $('.target').title = target === 'mine'
    ? 'Your browser signs with your agent key, exactly as a tricked agent would. Honest jobs first: scams spend today\'s limits.'
    : `No wallet needed: our server's runner key signs for you on a factory charter with tight rules. Daily limits are shared by everyone.${CFG.attack_enabled ? '' : ' The shared runner is off on this deployment.'}`;
  $('#score-h').textContent = target === 'mine' ? "Your charter's score" : 'Shared charter score';
  arenaCards(); $('#arena .result').innerHTML = ''; loadScore(target).catch(() => {});
}
function arenaCards() {
  const w = target;
  $('#arena .tsks').innerHTML = CFG.tasks.map(t => `<button class="atk tsk" data-where="${w}" data-task="${esc(t.id)}" data-testid="task-${w}-${esc(t.id)}" title="${esc(t.story)}">
    <b>${esc(t.name)}</b><em class="ok">allowed</em></button>`).join('');
  $('#arena .scams').innerHTML = CFG.attacks.map(a => `<button class="atk scam" data-where="${w}" data-attack="${esc(a.id)}" data-testid="atk-${w}-${esc(a.id)}" title="${esc(a.story)}">
    <b>${esc(a.name)}</b><em>${esc(plain(a.expects))}</em></button>`).join('');
  for (const b of $('#arena .tsks').querySelectorAll('.tsk')) b.onclick = () => task(b).catch(fail).finally(unlock);
  for (const b of $('#arena .scams').querySelectorAll('.scam')) b.onclick = () => attack(b).catch(fail).finally(unlock);
  if (w === 'mine') for (const b of $('#arena').querySelectorAll('.atk')) b.dataset.dup = '1';
}
const lock = () => { for (const x of document.querySelectorAll('.atk')) x.disabled = true; };
const unlock = () => { for (const x of document.querySelectorAll('.atk')) x.disabled = false; };
const outFor = btn => btn.closest('#mine') ? $('#mine .result') : $('#arena .result');
async function task(btn) {
  try { return await taskRun(btn); }
  catch (e) { outFor(btn).insertAdjacentHTML('beforeend', `<p class="verdict bad" data-testid="task-error">Stopped before a verdict: ${esc(e.message)}. Try again in a minute.</p>`); throw e; }
}
async function taskRun(btn) {
  lock();
  const where = btn.dataset.where, id = btn.dataset.task;
  const out = outFor(btn);
  out.innerHTML = `<p class="muted">Paying for <b>${esc(id)}</b> on chain…</p><ol class="steps"></ol>`;
  let r;
  if (where === 'mine') {
    r = await runTask({ charter, key: keyFrom(localStorage.getItem(agentLS(charter))), taskId: id, tag: 'mine', rpcCall: rpc, viewF: view, send: sendPropose });
    if (r.tx) await post('/api/vault/record', { tx: r.tx, charter }).catch(e => toast('Scoreboard did not take it: ' + esc(e.message), 'bad'));
    renderFacts().catch(() => {});
  } else r = await post('/api/vault/task', { task: id, nickname: nick() });
  out.querySelector('.steps').innerHTML = stepRow(r, 1, 1); record(r, where === 'mine' ? 'Job ' + id : 'Shared job ' + id);
  out.insertAdjacentHTML('beforeend', r.passed
    ? `<p class="verdict good" data-testid="verdict">ALLOWED: the charter allowed the honest payment: ${fmt(r.amount)} to <code>${esc(r.receiver)}</code>. ${txl(r.tx, 'see the transaction')}</p>`
    : `<p class="verdict bad" data-testid="verdict">The honest payment did not go through: ${esc(plain(r.reason || r.decision))}</p>`);
  loadScore(where).catch(() => {}); loadBoard().catch(() => {});
}
function nick() {
  const v = ($('#nick').value || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
  if (v) localStorage.setItem('nearcarta.vault.nick', v);
  return v || 'guest';
}
// A friendly default name, kept in this browser; anyone can change it.
function defaultNick() {
  let n = localStorage.getItem('nearcarta.vault.nick');
  if (!n) { const A = ['brave', 'calm', 'quick', 'sly', 'keen', 'bold', 'wise', 'lucky'], B = ['otter', 'heron', 'lynx', 'fox', 'owl', 'badger', 'gecko', 'crane'];
    const r = crypto.getRandomValues(new Uint16Array(3)); n = `${A[r[0] % 8]}-${B[r[1] % 8]}-${r[2] % 100}`; localStorage.setItem('nearcarta.vault.nick', n); }
  return n;
}
async function loadScore(where) {
  const id = where === 'mine' ? charter : CFG.arena.charter; if (!id) return;
  const s = await api('/api/vault/score/' + id);
  const cell = r => !r ? '<span class="muted">not run</span>' : r.counted ? `<span class="tag ok">counted</span> ${txl(r.tx)}` : `<span class="tag">${esc(r.why || r.reason || r.decision)}</span> ${txl(r.tx)}`;
  const html = `<p><b data-testid="score-${where}">${s.score}/${s.max_score}</b> · <span title="${s.tasks_passed} of ${s.tasks.length} honest payments allowed, ${s.scams_blocked} of ${s.attacks.length} scams refused for the right reason">jobs ${s.tasks_passed}/${s.tasks.length} · scams ${s.scams_blocked}/${s.attacks.length}</span></p>
    <table><thead><tr><th>Job</th><th>Should be</th><th>Result</th></tr></thead><tbody>
    ${[...s.tasks, ...s.attacks].map(x => `<tr><td>${esc(x.name)}</td><td${Array.isArray(x.expects) ? ` title="${esc(x.expects.map(plain).join(' or '))}">refused` : '>allowed'}</td><td>${cell(x.result)}</td></tr>`).join('')}</tbody></table>`;
  if (where === 'mine') $('#score-mine-box').innerHTML = html.replace('data-testid="score-mine"', 'data-testid="score-mine-top"');
  if (where === target) $('#arena .score').innerHTML = html;
}
function stepRow(s, i, n) {
  const cls = s.decision === 'denied' ? 'denied' : s.decision === 'allowed' ? 'allowed' : 'failed';
  return `<li class="${cls}"><span class="n">${i}${n ? '/' + n : ''}</span><span class="d" data-testid="decision">${s.decision === 'denied' ? 'REFUSED' : esc(s.decision)}</span>
    <span>${fmt(s.amount)} → <code>${esc(s.receiver)}</code></span><span class="r">${esc(s.reason ? plain(s.reason) : '')}</span>${txl(s.tx)}</li>`;
}
async function attack(btn) {
  try { return await attackRun(btn); }
  catch (e) { outFor(btn).insertAdjacentHTML('beforeend', `<p class="verdict bad" data-testid="attack-error">Stopped before a verdict: ${esc(e.message)}. Nothing was counted; try again in a minute.</p>`); throw e; }
}
async function attackRun(btn) {
  lock();
  const where = btn.dataset.where, id = btn.dataset.attack;
  const out = outFor(btn);
  out.innerHTML = `<p class="muted">Running <b>${esc(id)}</b> on chain…</p><ol class="steps"></ol>`;
  let r;
  if (where === 'mine') {
    const key = keyFrom(localStorage.getItem(agentLS(charter)));
    r = await runSteps({ charter, key, attackId: id, tag: 'mine', rpcCall: rpc, viewF: view, send: sendPropose,
      onStep: (s, i, n) => { out.querySelector('.steps').insertAdjacentHTML('beforeend', stepRow(s, i, n)); record(s, 'Scam ' + id); } });
    if (r.refused) await post('/api/vault/record', { tx: r.steps.at(-1).tx, charter }).catch(e => toast('Leaderboard did not take it: ' + esc(e.message), 'bad'));
    renderFacts().catch(() => {});
  } else {
    r = await post('/api/vault/attack', { attack: id, nickname: nick() });
    out.querySelector('.steps').innerHTML = r.steps.map((s, i) => stepRow(s, i + 1, r.steps.length)).join('');
    for (const s of r.steps) record(s, 'Shared scam ' + id);
  }
  out.insertAdjacentHTML('beforeend', r.refused
    ? `<p class="verdict good" data-testid="verdict">The charter refused it: <b>${esc(plain(r.reason))}</b> <code>${esc(r.reason)}</code> · ${txl(r.steps.at(-1).tx, 'tx')}</p>`
    : `<p class="verdict bad" data-testid="verdict">Not refused${r.steps.length ? '' : ' (no step ran)'}. ${esc(r.reason || '')}</p>`);
  if (r.why && r.why !== 'not_refused') out.insertAdjacentHTML('beforeend', `<p class="muted">Not counted: ${esc(r.why)}</p>`);
  loadScore(where).catch(() => {}); loadBoard().catch(() => {});
}

async function loadBoard() {
  const b = await api('/api/vault/leaderboard');
  $('#board').innerHTML = `<table data-testid="board"><thead><tr><th>#</th><th>Player</th><th>Score</th><th>Jobs</th><th>Scams</th><th>Last tx</th></tr></thead><tbody>
    ${b.players.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.player)} ${p.verified ? '<span class="tag ok" title="owner of the charter, checked on chain">owner</span>' : '<span class="tag" title="nickname on the shared charter; the txs are signed by this server\'s runner">nick · server-signed</span>'}</td>
    <td><b>${p.score}/${p.max_score}</b></td><td title="${esc(p.tasks.join(', '))}">${p.tasks.length}</td>
    <td title="${esc(p.patterns.join(', '))}">${p.patterns.length}</td><td>${txl(p.last_tx)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing counted yet.</td></tr>'}</tbody></table>`;
  $('#s-board h2').title = (b.rule || '') + (b.complete ? '' : ' (still indexing)');
}
function showTab(id) {
  for (const t of document.querySelectorAll('[role=tab]')) { const on = t.dataset.tab === id; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; $('#' + t.dataset.tab).hidden = !on; }
  if (id === 'p-board') loadBoard().catch(() => {});
}

// Bound before the config fetch so a click during page start waits for the connector instead of being lost.
let booted; const boot = new Promise((ok, no) => { booted = { ok, no }; }); boot.catch(() => {});
$('#connect').onclick = () => boot.then(() => connector.connect()).catch(fail);
$('#guest').onclick = async () => { busy($('#guest'), true, 'Asking the testnet faucet…'); try { await boot; await connector.connect({ walletId: 'nearcarta-guest' }); await refreshWho(); } catch (e) { fail(e); } finally { busy($('#guest'), false); } };

async function main() {
  CFG = await api('/api/vault/config').catch(e => { booted.no(e); throw e; });
  // Same order as the server runner: the primary RPC, then the fallbacks when one answers 429/5xx or is unreachable.
  rpc = rpcClient([CFG.rpc, ...(CFG.rpc_fallbacks || [])]);
  ({ connector } = makeConnector(rpc));
  for (const t of document.querySelectorAll('[role=tab]')) {
    t.onclick = () => { showTab(t.dataset.tab); history.replaceState(null, '', '#' + t.id.slice(4)); };
    t.onkeydown = e => { const all = [...document.querySelectorAll('[role=tab]')]; const i = all.indexOf(t) + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
      if (i !== all.indexOf(t)) { const n = all[(i + all.length) % all.length]; n.focus(); n.click(); } };
  }
  const h = location.hash.slice(1); if (['mine', 'arena', 'board'].includes(h)) showTab('p-' + h);
  $('#go-arena').onclick = () => { showTab('p-arena'); setTarget('mine'); };
  for (const r of document.querySelectorAll('input[name=target]')) r.onchange = () => setTarget(r.value);
  $('#nick').value = defaultNick();
  $('#ask-form').onsubmit = e => ask(e).catch(fail);
  $('#factory').innerHTML = `Factory <code>${esc(CFG.factory)}</code> · code hash <code title="${esc(CFG.code_hash)}">${esc(short(CFG.code_hash))}</code> · ${txl(CFG.proof_txs?.factory_full_access_key_deleted, 'factory keys deleted')}`;
  $('#arena-id').textContent = CFG.arena.charter;
  $('#ex-look').textContent = lookalike(CFG.arena.merchants[0]);
  quickCards(); setTarget('shared');
  const rl = CFG.runner; if (rl) $('#runner').title = `Shared runner: ${rl.left_today} of ${rl.daily_tx_cap} transactions left today (UTC), ${rl.gas_tgas} Tgas each.`;
  connector.on('wallet:signIn', () => refreshWho().then(signedIn).catch(fail));
  booted.ok();
  connector.on('wallet:signOut', () => { charter = null; ready = false; refreshWho().catch(fail); });
  $('#signout').onclick = async () => { await connector.disconnect().catch(() => {}); if (hasGuest() && confirm('Forget the guest account key in this browser? Its testnet NEAR is lost.')) forgetGuest(); charter = null; ready = false; await refreshWho(); };
  await refreshWho(); await loadBoard().catch(e => { $('#board').textContent = e.message; });
}
main().catch(fail);
