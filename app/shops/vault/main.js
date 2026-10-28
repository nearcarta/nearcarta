// Charter shop + Vault Arena. Wallet signs owner steps; the agent key made here signs `propose`.
import { makeConnector, currentAccount, txHashOf, hasGuest, forgetGuest } from './wallet.js';
import { rpcClient, viewFn, keyFrom, sendPropose } from '../../../shared/vault/tx.js';
import { runSteps } from '../../../shared/vault/run.js';
import { lookalike } from '../../../shared/vault/attacks.js';

const API = (window.NEARCARTA_API || '').replace(/\/$/, '');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const YN = 10n ** 24n, TG = 10n ** 12n;
const toY = n => (BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n).toString();
const fmt = y => { if (y == null) return '–'; const v = Number(BigInt(y) / 10n ** 18n) / 1e6; return (v < 0.01 && v > 0 ? v.toFixed(3) : +v.toFixed(4)) + ' NEAR'; };
const short = h => h ? h.slice(0, 6) + '…' + h.slice(-4) : '';
let CFG, rpc, connector, me = null, charter = null;

async function api(path, opts) {
  const r = await fetch(API + path, opts); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'http ' + r.status); return j;
}
const view = (c, m, a) => viewFn(rpc, c, m, a);
const txl = (h, label) => h ? `<a class="tx" data-testid="tx" href="${esc(CFG.explorer || 'https://testnet.nearblocks.io')}/txns/${esc(h)}" target="_blank" rel="noopener">${esc(label || short(h))}<span aria-hidden="true">↗</span></a>` : '';
const agentLS = c => 'nearcarta.vault.agent.' + c;
function toast(html, kind = 'info') { const t = $('#log'); const li = document.createElement('li'); li.className = kind; li.innerHTML = html; t.prepend(li); }
function busy(btn, on, label) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Waiting for chain…'; } else if (btn.dataset.l) btn.textContent = btn.dataset.l; }
const fail = e => toast(`<b>Stopped:</b> ${esc(e.message)}${e.tx ? ' · ' + txl(e.tx) : ''}`, 'bad');

// ---------- step 1: wallet ----------
async function refreshWho() {
  me = await currentAccount(connector);
  $('#who').innerHTML = me ? `Signed in as <b data-testid="who">${esc(me)}</b>` : 'Not connected';
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
  if (!me) { box.innerHTML = '<p class="muted">Connect first. A charter is a NEAR account that holds your agent\'s money and its rules.</p>'; return; }
  if (charter) { box.innerHTML = `<p>Your charter: <b data-testid="charter-id">${esc(charter)}</b></p>`; return; }
  const base = me.split('.')[0].replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'my';
  box.innerHTML = `<label>Name <span class="suffix"><input id="cname" value="${esc(base)}" maxlength="32" pattern="[a-z0-9-]+" aria-describedby="cname-h"><span>.${esc(CFG.factory)}</span></span></label>
    <label>Money to put in <span class="suffix"><input id="cdep" type="number" min="0.3" max="5" step="0.1" value="0.5"><span>NEAR</span></span></label>
    <p id="cname-h" class="muted">The factory creates the account, points it at the audited oath code (by hash, nothing is uploaded), and makes you the owner. It keeps 0.01 NEAR as a fee.</p>
    <button id="create-btn" class="primary" data-testid="create">Create my charter</button>`;
  $('#create-btn').onclick = () => createCharter().catch(fail).finally(() => busy($('#create-btn'), false));
}
async function createCharter() {
  const name = $('#cname').value.trim().toLowerCase(), dep = Number($('#cdep').value);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error('name: a-z, 0-9 and single dashes');
  if (!(dep >= 0.3 && dep <= 5)) throw new Error('deposit must be 0.3 to 5 NEAR');
  busy($('#create-btn'), true, 'Approve in your wallet…');
  const w = await connector.wallet();
  const res = await w.signAndSendTransaction({ receiverId: CFG.factory, actions: [{ type: 'FunctionCall', params: { methodName: 'create_charter', args: { name }, gas: (150n * TG).toString(), deposit: toY(dep) } }] });
  const h = txHashOf(res); const id = `${name}.${CFG.factory}`;
  const f = await facts(id, f => f.registered && f.exists && !f.pending);
  if (!f.registered) throw Object.assign(new Error('charter not created (name taken? the deposit was refunded minus gas)'), { tx: h });
  toast(`Charter created · ${txl(h)}`, 'good'); await useCharter(id);
}

// ---------- step 3: rules + agent key ----------
async function useCharter(id) { charter = id; document.body.dataset.step = 'charter'; renderCreate(); await renderFacts(); }
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
  const cl = f.clauses?.pay; const u = f.usage?.pay;
  const k = localStorage.getItem(agentLS(charter)); const agentPk = k ? keyFrom(k).publicKey : null;
  const keyLive = agentPk && (f.agent_keys || []).some(a => a.public_key === agentPk);
  $('#facts').innerHTML = `<ul class="facts" data-testid="facts">
    <li class="${f.runs_r14 ? 'ok' : 'no'}">Runs the audited oath code <code title="${esc(CFG.code_hash)}">${esc(short(CFG.code_hash))}</code></li>
    <li class="${f.full_access_keys === 0 ? 'ok' : 'no'}">${f.full_access_keys} full-access keys (nobody can bypass the rules)</li>
    <li class="${f.owner === me ? 'ok' : 'no'}">Owner: ${esc(f.owner)}</li>
    <li>Balance: ${fmt(f.balance)}</li>
    <li class="${cl ? 'ok' : 'todo'}">${cl ? `Rules: pays only ${cl.receivers.map(esc).join(', ')} · max ${fmt(cl.per_action_cap)} each · ${fmt(cl.daily_budget)} a day · ${cl.max_actions_per_day || '∞'} payments a day` : 'No rules yet'}</li>
    ${u ? `<li>Today: spent ${fmt(u.spent)} in ${u.count} payments</li>` : ''}
    <li class="${keyLive ? 'ok' : 'todo'}">${keyLive ? `Agent key in this browser, can only call <code>propose</code>` : 'No agent key in this browser yet'}</li></ul>`;
  renderRules(cl, keyLive);
  $('#mine').hidden = !(cl && keyLive);
}
function renderRules(cl, keyLive) {
  const m = CFG.arena.merchants;
  $('#rules').innerHTML = `<div class="grid2">
    <label>Allowed payee 1<input id="r1" value="${esc(cl?.receivers?.[0] || m[0])}"></label>
    <label>Allowed payee 2<input id="r2" value="${esc(cl?.receivers?.[1] || m[1])}"></label>
    <label>Max per payment<span class="suffix"><input id="rcap" type="number" step="0.01" min="0.002" value="${cl ? Number(BigInt(cl.per_action_cap) / 10n ** 18n) / 1e6 : 0.05}"><span>NEAR</span></span></label>
    <label>Daily budget<span class="suffix"><input id="rbud" type="number" step="0.01" min="0.002" value="${cl ? Number(BigInt(cl.daily_budget) / 10n ** 18n) / 1e6 : 0.1}"><span>NEAR</span></span></label>
    <label>Payments per day<input id="rmax" type="number" min="1" max="50" value="${cl?.max_actions_per_day || 4}"></label>
    <label>Smallest payment<span class="suffix"><input id="rmin" type="number" step="0.001" min="0.001" value="0.001"><span>NEAR</span></span></label></div>
    <p class="muted">One wallet approval does two things: saves these rules on chain and adds a fresh agent key made in this browser. That key can only call <code>propose</code> on this charter; it cannot move money around the rules.</p>
    <button id="rules-btn" class="primary" data-testid="rules">${cl && keyLive ? 'Update rules' : 'Save rules and issue agent key'}</button>`;
  $('#rules-btn').onclick = () => saveRules(keyLive).catch(fail).finally(() => busy($('#rules-btn'), false));
}
async function saveRules(keyLive) {
  const rec = [$('#r1').value.trim(), $('#r2').value.trim()].filter(Boolean);
  const clause = { asset: 'Native', receivers: rec, per_action_cap: toY($('#rcap').value), daily_budget: toY($('#rbud').value),
    window_start_min: 0, window_end_min: 0, requires_receipt: false, escalation_max: null, min_amount: toY($('#rmin').value), max_actions_per_day: Number($('#rmax').value) };
  if (BigInt(clause.per_action_cap) > BigInt(clause.daily_budget)) throw new Error('max per payment is above the daily budget');
  const actions = [{ type: 'FunctionCall', params: { methodName: 'set_clause', args: { clause_id: 'pay', clause }, gas: (40n * TG).toString(), deposit: '0' } }];
  let k = localStorage.getItem(agentLS(charter));
  if (!keyLive) { k = keyFrom().secretKey;
    actions.push({ type: 'FunctionCall', params: { methodName: 'set_agent_key', args: { public_key: keyFrom(k).publicKey, allowance: (YN / 2n).toString() }, gas: (60n * TG).toString(), deposit: '0' } }); }
  busy($('#rules-btn'), true, 'Approve in your wallet…');
  const w = await connector.wallet();
  const res = await w.signAndSendTransaction({ receiverId: charter, actions });
  if (!keyLive) localStorage.setItem(agentLS(charter), k);
  toast(`Rules saved${keyLive ? '' : ' and agent key issued'} · ${txl(txHashOf(res))}`, 'good');
  await renderFacts();
}

// ---------- step 4 + arena ----------
function attackCards() {
  const tpl = (where) => CFG.attacks.map(a => `<button class="atk" data-where="${where}" data-attack="${esc(a.id)}" data-testid="atk-${where}-${esc(a.id)}">
    <b>${esc(a.name)}</b><span>${esc(a.story)}</span><em>expect: ${esc(a.expects)}</em></button>`).join('');
  $('#mine .atks').innerHTML = tpl('mine'); $('#shared .atks').innerHTML = tpl('shared');
  for (const b of document.querySelectorAll('.atk')) b.onclick = () => attack(b).catch(fail).finally(() => { for (const x of document.querySelectorAll('.atk')) x.disabled = false; });
}
function stepRow(s, i, n) {
  const cls = s.decision === 'denied' ? 'denied' : s.decision === 'allowed' ? 'allowed' : 'failed';
  return `<li class="${cls}"><span class="n">${i}${n ? '/' + n : ''}</span><span class="d" data-testid="decision">${s.decision === 'denied' ? 'REFUSED' : esc(s.decision)}</span>
    <span>${fmt(s.amount)} → <code>${esc(s.receiver)}</code></span><span class="r">${esc(s.reason || '')}</span>${txl(s.tx)}</li>`;
}
async function attack(btn) {
  for (const x of document.querySelectorAll('.atk')) x.disabled = true;
  const where = btn.dataset.where, id = btn.dataset.attack;
  const out = $(`#${where} .result`);
  out.innerHTML = `<p class="muted">Running <b>${esc(id)}</b>: each step is a real testnet transaction, waiting for finality…</p><ol class="steps"></ol>`;
  let r;
  if (where === 'mine') {
    const key = keyFrom(localStorage.getItem(agentLS(charter)));
    r = await runSteps({ charter, key, attackId: id, tag: 'mine', rpcCall: rpc, viewF: view, send: sendPropose,
      onStep: (s, i, n) => out.querySelector('.steps').insertAdjacentHTML('beforeend', stepRow(s, i, n)) });
    if (r.refused) await api('/api/vault/record', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx: r.steps.at(-1).tx, charter }) }).catch(e => toast('Leaderboard did not take it: ' + esc(e.message), 'bad'));
    renderFacts().catch(() => {});
  } else {
    const nick = ($('#nick').value || 'guest').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'guest';
    r = await api('/api/vault/attack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attack: id, nickname: nick }) });
    out.querySelector('.steps').innerHTML = r.steps.map((s, i) => stepRow(s, i + 1, r.steps.length)).join('');
  }
  out.insertAdjacentHTML('beforeend', r.refused
    ? `<p class="verdict good" data-testid="verdict">The charter refused it: <b>${esc(r.reason)}</b>. The refusal is on chain: ${txl(r.steps.at(-1).tx, 'see the transaction')}</p>`
    : `<p class="verdict bad" data-testid="verdict">Not refused${r.steps.length ? '' : ' (no step ran)'}. ${esc(r.reason || '')}</p>`);
  loadBoard().catch(() => {});
}

async function loadBoard() {
  const b = await api('/api/vault/leaderboard');
  $('#board').innerHTML = `<table data-testid="board"><thead><tr><th>#</th><th>Player</th><th>Patterns refused</th><th>Refusals</th><th>Last proof</th></tr></thead><tbody>
    ${b.players.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.player)} ${p.verified ? '<span class="tag ok" title="owner of the charter, checked on chain">owner</span>' : '<span class="tag" title="nickname on the shared charter, not verified">nick</span>'}</td>
    <td>${p.patterns.map(x => `<span class="pill">${esc(x)}</span>`).join(' ')}</td><td>${p.refusals}</td><td>${txl(p.last_tx)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No refusals yet.</td></tr>'}</tbody></table>
    <p class="muted">${esc(b.rule)} ${b.complete ? '' : '(still indexing)'}</p>`;
}

async function main() {
  CFG = await api('/api/vault/config');
  rpc = rpcClient(CFG.rpc);
  ({ connector } = makeConnector(rpc));
  $('#factory').innerHTML = `Factory <code>${esc(CFG.factory)}</code> · code hash <code title="${esc(CFG.code_hash)}">${esc(short(CFG.code_hash))}</code> · ${txl(CFG.proof_txs?.factory_full_access_key_deleted, 'factory keys deleted')}`;
  $('#arena-id').textContent = CFG.arena.charter;
  $('#shared-note').textContent = CFG.attack_enabled ? '' : 'The shared runner is off on this deployment. Use your own charter above.';
  $('#ex-look').textContent = lookalike(CFG.arena.merchants[0]);
  attackCards();
  connector.on('wallet:signIn', () => refreshWho().catch(fail));
  connector.on('wallet:signOut', () => { charter = null; refreshWho().catch(fail); });
  $('#connect').onclick = () => connector.connect().catch(fail);
  $('#guest').onclick = async () => { busy($('#guest'), true, 'Asking the testnet faucet…'); try { await connector.connect({ walletId: 'nearcarta-guest' }); await refreshWho(); } catch (e) { fail(e); } finally { busy($('#guest'), false); } };
  $('#signout').onclick = async () => { await connector.disconnect().catch(() => {}); if (hasGuest() && confirm('Forget the guest account key in this browser? Its testnet NEAR is lost.')) forgetGuest(); charter = null; await refreshWho(); };
  await refreshWho(); await loadBoard().catch(e => { $('#board').textContent = e.message; });
}
main().catch(fail);
