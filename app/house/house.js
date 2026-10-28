// Your House: the owner governs their own charter from their own NEAR wallet (testnet).
// The console never holds a key. Every governance call is signed in the wallet's own window
// (MyNearWallet popup or Meteor), via NEAR Wallet Selector. Sign-in asks for no access key,
// so each freeze / unfreeze / approve / deny is approved by the owner one by one.
import { setupWalletSelector } from '@near-wallet-selector/core';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { actionCreators } from '@near-js/transactions';

const API = (window.NEARCARTA_API || '').replace(/\/$/, '');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const txl = h => `<a data-testid="house-tx" href="https://testnet.nearblocks.io/txns/${esc(h)}" target="_blank" rel="noopener">${esc(h)}</a>`;
const near = y => (y == null ? '–' : (Number(BigInt(y) / 10n ** 18n) / 1e6).toString() + ' NEAR');
const GAS = 50_000_000_000_000n;
let selector, house;

async function load() {
  const r = await fetch(API + '/api/house'); house = await r.json();
  if (!r.ok) throw new Error(house.error || 'http ' + r.status);
  return house;
}

async function account() {
  if (!selector?.isSignedIn()) return null;
  const w = await selector.wallet(); const [a] = await w.getAccounts(); return a?.accountId || null;
}

async function render() {
  const out = $('#house .out');
  const h = await load(); const who = await account();
  const s = h.state;
  const pend = Object.entries(h.actions || {}).filter(([, a]) => a?.status === 'escalated');
  const isOwner = who === h.owner;
  const btn = (act, label, extra = '') => `<button data-act="${act}" ${extra} ${isOwner ? '' : 'disabled'}>${label}</button>`;
  out.innerHTML = `<div class="card" data-testid="house-state">House ${esc(h.oath)} · owner <b>${esc(h.owner)}</b> · ${h.dao ? 'DAO ' + esc(h.dao) : 'no DAO, so the owner may unfreeze'}<br>
    Status: <b data-testid="house-frozen" class="${s.frozen ? 'fail' : 'pass'}">${s.frozen ? 'FROZEN' : 'active'}</b> · freeze epoch ${esc(s.freeze_epoch)} · next action ${esc(s.next_action)}<br>
    Full-access keys: <b data-testid="house-fak">${h.keys.fullAccess}</b> · agent key may call: <b>${esc(h.keys.functionCall.map(k => k.methods.join(',')).join(' | '))}</b> · code hash <code>${esc(h.code_hash)}</code></div>
  <div class="card"><b>Wallet</b> · <span data-testid="house-who">${who ? 'signed in as ' + esc(who) + (isOwner ? ' (owner)' : ' (not the owner: buttons are off)') : 'not signed in'}</span><br>
    ${who ? '<button data-act="signout">Sign out</button>' : '<button data-act="signin" data-wallet="my-near-wallet">Sign in with MyNearWallet</button> <button data-act="signin" data-wallet="meteor-wallet">Sign in with Meteor</button>'}</div>
  <div class="card"><b>Emergency</b> · ${btn('freeze', 'Freeze the House')} ${btn('unfreeze', 'Unfreeze')}
    <p class="note">Freeze stops every agent spend at once. It is signed by your wallet, never by this page.</p></div>
  <div class="card" data-testid="house-pending"><b>Waiting for you</b> (agent spends over the cap, held by the contract with NEP-519 yield, about 200 blocks)
    ${pend.length ? `<table><tr><th>#</th><th>clause</th><th>to</th><th>amount</th><th></th></tr>${pend.map(([id, a]) => `<tr data-action="${esc(id)}"><td>${esc(id)}</td><td>${esc(a.p?.clause_id ?? a.clause_id)}</td><td>${esc(a.p?.receiver ?? a.receiver)}</td><td>${near(a.p?.amount ?? a.amount)}</td>
      <td>${btn('approve', 'Approve', `data-id="${esc(id)}"`)} ${btn('deny', 'Deny', `data-id="${esc(id)}"`)}</td></tr>`).join('')}</table>` : '<p class="note" data-testid="house-none">Nothing waiting.</p>'}</div>
  <div id="house-log" class="card" aria-live="polite"></div>`;
  for (const b of out.querySelectorAll('button[data-act]')) b.onclick = () => act(b).catch(e => log(`<span class="fail" data-testid="house-error">${esc(e.message)}</span>`));
}

function log(html) { const l = $('#house-log'); if (l) l.innerHTML = html + (l.innerHTML ? '<br>' + l.innerHTML : ''); }

async function call(methodName, args) {
  const w = await selector.wallet();
  const res = await w.signAndSendTransaction({ receiverId: house.oath,
    actions: [actionCreators.functionCall(methodName, args, GAS, 0n)] });
  const hash = res?.transaction?.hash || res?.transaction_outcome?.id || (Array.isArray(res) ? res[0]?.transaction?.hash : null);
  return hash;
}

async function act(b) {
  const a = b.dataset.act;
  if (a === 'signin') { const w = await selector.wallet(b.dataset.wallet); await w.signIn({ contractId: '', methodNames: [] }); return render(); }
  if (a === 'signout') { await (await selector.wallet()).signOut(); return render(); }
  b.disabled = true; log(`${esc(a)}: waiting for your wallet…`);
  const hash = a === 'freeze' ? await call('freeze', {}) : a === 'unfreeze' ? await call('unfreeze', {})
    : await call('resolve_escalation', { action_id: b.dataset.id, approve: a === 'approve' });
  log(`<span data-testid="house-done" data-act="${esc(a)}">${esc(a)} signed by your wallet: ${hash ? txl(hash) : '(no hash returned)'}</span>`);
  await new Promise(r => setTimeout(r, 2500)); await render();
}

export async function mountHouse() {
  selector ??= await setupWalletSelector({ network: 'testnet', modules: [setupMyNearWallet(), setupMeteorWallet()] });
  await render();
}
window.mountHouse = mountHouse;
