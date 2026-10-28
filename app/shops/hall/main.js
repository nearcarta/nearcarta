// Town Hall: a visitor files a real Sputnik DAO proposal (add_proposal, 0.1 NEAR bond) on testnet.
// The visitor's own wallet signs (NEAR Connect or the guest faucet account). The backend signs nothing here.
// "join" proposes a FunctionCall to the Town Hall charter: set_clause("reward") with the visitor added to
// the receivers. It changes the charter only if the DAO council approves it (2 of 2) and the timelock passes.
import { makeConnector, currentAccount, txHashOf, hasGuest, forgetGuest } from '../vault/wallet.js';
import { rpcClient, viewFn } from '../../../shared/vault/tx.js';

export const DAO = 'r7thmvr8maey.sputnikv2.testnet';
export const CHARTER = 'townhall.r7thmvr8maey-council2.testnet';
const API = (window.NEARCARTA_API || '').replace(/\/$/, '');
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = y => (Number(BigInt(y) / 10n ** 18n) / 1e6) + ' NEAR';
const b64 = o => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
let CFG, rpc, connector, me = null, policy = null, mineIds = new Set(JSON.parse(sessionStorage.getItem('nearcarta.hall.mine') || '[]'));
const view = (c, m, a) => viewFn(rpc, c, m, a);
const explorer = () => CFG?.explorer || 'https://testnet.nearblocks.io';
const txl = h => `<a class="tx" data-testid="tx" href="${esc(explorer())}/txns/${esc(h)}" target="_blank" rel="noopener">${esc(h.slice(0, 6) + '…' + h.slice(-4))}<span aria-hidden="true">↗</span></a>`;
const log = (html, kind = 'info') => { const li = document.createElement('li'); li.className = kind; li.innerHTML = html; $('#log').prepend(li); };

/** The add_proposal args for a kind. Pure, so tests can check it. */
export function proposalFor(kind, { me, desc, clause }) {
  const description = (desc || '').trim().slice(0, 280) || (kind === 'join' ? `Add ${me} to the Town Hall reward list` : `Motion from ${me}`);
  if (kind === 'motion') return { proposal: { description, kind: 'Vote' } };
  if (!clause) throw new Error('the charter has no reward clause to join');
  if (clause.receivers.includes(me)) throw new Error('you are already on the reward list');
  const next = { ...clause, receivers: [...clause.receivers, me] };
  return { proposal: { description, kind: { FunctionCall: { receiver_id: CHARTER, actions: [
    { method_name: 'set_clause', args: b64({ clause_id: 'reward', clause: next }), deposit: '0', gas: '60000000000000' }] } } } };
}

async function facts() {
  const [p, clauses, st] = await Promise.all([view(DAO, 'get_policy'), view(CHARTER, 'get_clauses'), view(CHARTER, 'get_state')]);
  policy = p;
  const council = p.roles.find(r => r.name === 'council')?.kind?.Group || [];
  const anyone = p.roles.some(r => r.kind === 'Everyone' && r.permissions.some(x => x === '*:AddProposal'));
  const hours = Number(BigInt(p.proposal_period) / 10n ** 9n) / 3600;
  $('#bond').textContent = `Bond ${fmt(p.proposal_bond)} (testnet), signed by your wallet. The vote stays open ${hours} h.`;
  $('#facts').innerHTML = `<p>DAO <code>${esc(DAO)}</code> owns the charter <code>${esc(CHARTER)}</code> (owner: <code>${esc(st.owner)}</code>).</p>
    <p>${anyone ? 'Anyone may file a proposal.' : 'Only members may file.'} Council of ${council.length} votes: ${council.map(c => `<code>${esc(c)}</code>`).join(', ')}.</p>
    <p>Reward list today: ${(clauses.reward?.receivers || []).map(r => `<code>${esc(r)}</code>`).join(', ') || 'none'}, up to ${clauses.reward ? fmt(clauses.reward.per_action_cap) : '–'} each.</p>
    <p class="muted">An approved charter change waits the charter's timelock (${Number(BigInt(st.policy_delay_ns) / 10n ** 9n) / 60} min) before it applies.</p>`;
  return clauses;
}

async function list(want = null) {
  let last = await view(DAO, 'get_last_proposal_id');
  // RPC nodes can lag a just-final tx: wait (up to ~10 s) until the new proposal is listed.
  for (let i = 0; want != null && last <= want && i < 5; i++) { await new Promise(r => setTimeout(r, 2000)); last = await view(DAO, 'get_last_proposal_id'); }
  const ps = await view(DAO, 'get_proposals', { from_index: Math.max(0, last - 6), limit: 6 });
  $('#list').innerHTML = `<ul class="props">${ps.reverse().map(p => `<li class="${mineIds.has(p.id) ? 'mine' : ''}" data-id="${p.id}"><b>#${p.id}</b><span class="st">${esc(p.status)}</span>
    <span class="muted"> by <code>${esc(p.proposer)}</code> · ${esc(typeof p.kind === 'string' ? p.kind : Object.keys(p.kind)[0])}</span><br>${esc(p.description)}</li>`).join('')}</ul>`;
  return last;
}

async function refreshWho() {
  me = await currentAccount(connector);
  $('#who').innerHTML = me ? `<b data-testid="who">${esc(me)}</b>` : '';
  $('#connect').hidden = !!me; $('#guest').hidden = !!me; $('#signout').hidden = !me;
  $('#file').disabled = !me; $('#file').textContent = me ? 'File proposal' : 'Start free or connect first';
}

function idFrom(res) {
  const r = Array.isArray(res) ? res[res.length - 1] : res;
  const sv = r?.status?.SuccessValue; if (!sv) return null;
  try { const n = JSON.parse(atob(sv)); return Number.isInteger(n) ? n : null; } catch { return null; }
}

async function file(e) {
  e.preventDefault();
  const btn = $('#file'); btn.disabled = true; btn.textContent = 'Waiting for your wallet…';
  try {
    const clauses = await view(CHARTER, 'get_clauses');
    const kind = document.querySelector('input[name=kind]:checked').value;
    const args = proposalFor(kind, { me, desc: $('#desc').value, clause: clauses.reward });
    const before = await view(DAO, 'get_last_proposal_id');
    const w = await connector.wallet();
    const res = await w.signAndSendTransaction({ receiverId: DAO, actions: [{ type: 'FunctionCall', params: { methodName: 'add_proposal', args, gas: '50000000000000', deposit: policy.proposal_bond } }] });
    const h = txHashOf(res);
    let id = idFrom(res);
    if (id == null) { const ps = await view(DAO, 'get_proposals', { from_index: before, limit: 10 }); id = ps.filter(p => p.proposer === me).pop()?.id ?? null; }
    if (id != null) { mineIds.add(id); sessionStorage.setItem('nearcarta.hall.mine', JSON.stringify([...mineIds])); }
    $('#result').innerHTML = `<p class="ok" data-testid="filed" data-id="${id ?? ''}" data-tx="${esc(h || '')}">Filed proposal <b>#${id ?? '?'}</b> on <code>${esc(DAO)}</code>${h ? ' · ' + txl(h) : ''}. The council votes next.</p>`;
    btn.textContent = 'Filed';
    await list(id);
  } catch (err) { log(`<b>Stopped:</b> ${esc(err.message)}${err.tx ? ' · ' + txl(err.tx) : ''}`, 'bad err'); }
  finally { await refreshWho(); }
}

const boot = (async () => {
  CFG = await fetch(API + '/api/vault/config').then(r => r.json());
  rpc = rpcClient([CFG.rpc, ...(CFG.rpc_fallbacks || [])]);
  ({ connector } = makeConnector(rpc));
  connector.on?.('wallet:signIn', refreshWho); connector.on?.('wallet:signOut', refreshWho);
  await refreshWho();
  await Promise.all([facts(), list()]);
})();
boot.catch(e => log(`<b>Could not load:</b> ${esc(e.message)}`, 'bad err'));
$('#file-form').onsubmit = e => boot.then(() => file(e));
$('#connect').onclick = () => boot.then(() => connector.connect()).catch(e => log(esc(e.message), 'bad err'));
$('#guest').onclick = async () => { const b = $('#guest'); b.disabled = true; b.textContent = 'Asking the testnet faucet…';
  try { await boot; await connector.connect({ walletId: 'nearcarta-guest' }); await refreshWho(); } catch (e) { log(esc(e.message), 'bad err'); } finally { b.disabled = false; b.textContent = 'Start free'; } };
$('#signout').onclick = async () => { await connector.disconnect().catch(() => {}); if (hasGuest() && confirm('Forget the guest account key in this browser? Its testnet NEAR is lost.')) forgetGuest(); await refreshWho(); };
