// Your House: the owner governs their own charter from their own NEAR wallet (testnet).
// The page never holds a key. Wallets connect through NEAR Connect (@hot-labs/near-connect): each wallet's
// code runs in a sandboxed iframe, and every freeze / unfreeze / approve / deny is approved in the wallet, one by one.
// Sign-in asks for no access key.
import { NearConnector } from '@hot-labs/near-connect';

const API = (window.NEARCARTA_API || '').replace(/\/$/, '');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const txl = h => `<a data-testid="house-tx" href="https://testnet.nearblocks.io/txns/${esc(h)}" target="_blank" rel="noopener">${esc(String(h).slice(0, 10))}…</a>`;
const near = y => (y == null ? '–' : (Number(BigInt(y) / 10n ** 18n) / 1e6).toString() + ' NEAR');
const short = a => { const s = String(a ?? ''); return s.length > 28 ? s.slice(0, 12) + '…' + s.slice(-10) : s; };
export const FAUCET = 'https://docs.near.org/getting-started/faucet';
export const NEW_ACCOUNT = 'https://docs.near.org/getting-started/create-account';
const GAS = '50000000000000';
let connector, house;
const listeners = new Set();

export function wallet() {
  if (!connector) {
    connector = new NearConnector({ network: 'testnet', features: { testnet: true, signAndSendTransaction: true }, footerBranding: null });
    const ping = () => listeners.forEach(f => f());
    connector.on('wallet:signIn', ping); connector.on('wallet:signOut', ping);
    // Clear EVM label; wallets this browser already has go first.
    connector.whenManifestLoaded.then(() => {
      const evm = connector.wallets.find(w => w.manifest.id === 'ethereum-wallets');
      if (evm) evm.manifest.name = window.ethereum ? 'MetaMask & EVM wallets (detected)' : 'MetaMask & EVM wallets';
      if (evm && window.ethereum) connector.wallets = [evm, ...connector.wallets.filter(w => w !== evm)];
    }).catch(() => {});
  }
  return connector;
}
export function onWallet(f) { listeners.add(f); }
export async function account() {
  try { const { accounts } = await wallet().getConnectedWallet(); return accounts?.[0]?.accountId || null; } catch { return null; }
}
// Opens the wallet list, then signs in. `note` gets plain-text progress and errors (never swallowed).
export async function connect(note = () => {}) {
  const c = wallet();
  let id;
  try { id = await c.selectWallet(); } catch { note(''); return account(); }
  if (id === 'ethereum-wallets') note('In the evm-on-near.dev window that opens, press Connect Wallet, then MetaMask, and approve in MetaMask (it adds NEAR Protocol Testnet, chain 398). If no window opened, allow pop-ups for this site.');
  else note('Waiting for your wallet…');
  try { await c.connect({ walletId: id }); note(''); }
  catch (e) { note(`Could not connect: ${e?.message || e}`); throw e; }
  return account();
}
export async function disconnect() { await wallet().disconnect().catch(() => {}); }

// A small "Connect wallet" control for any page (the town uses it).
export async function mountConnect(el) {
  let msg;
  const draw = async () => {
    const who = await account();
    el.innerHTML = who
      ? `<a class="pill" href="/console#house" title="${esc(who)}">${esc(short(who))} · Your House</a><button type="button" class="pill" data-x="out">Sign out</button>`
      : `<button type="button" class="pill go" data-x="in">Connect wallet</button><a class="pill" href="${FAUCET}" target="_blank" rel="noopener">Free testnet NEAR</a>`;
    if (!msg) { msg = document.createElement('div'); msg.dataset.testid = 'wallet-note'; msg.setAttribute('role', 'status'); msg.style.cssText = 'flex-basis:100%;max-width:360px;font-size:12px;line-height:1.35;margin-top:4px;background:#2a1d14ee;color:#fbe9d0;padding:6px 8px;border-radius:8px'; }
    el.appendChild(msg);
    const note = t => { msg.textContent = t; msg.hidden = !t; };
    msg.hidden = !msg.textContent;
    el.querySelector('[data-x="in"]')?.addEventListener('click', () => connect(note).then(draw).catch(() => draw()));
    el.querySelector('[data-x="out"]')?.addEventListener('click', () => disconnect().then(draw));
  };
  onWallet(draw); await draw();
}

async function load() {
  const r = await fetch(API + '/api/house'); house = await r.json();
  if (!r.ok) throw new Error(house.error || 'http ' + r.status);
  return house;
}

async function render() {
  const out = $('#house .out');
  const h = await load(); const who = await account();
  const s = h.state;
  const pend = Object.entries(h.actions || {}).filter(([, a]) => a?.status === 'escalated');
  const isOwner = who === h.owner;
  const btn = (act, label, extra = '') => `<button data-act="${act}" ${extra} ${isOwner ? '' : 'disabled'}>${label}</button>`;
  out.innerHTML = `<div class="card" data-testid="house-state">House <span title="${esc(h.oath)}">${esc(short(h.oath))}</span> · owner <b title="${esc(h.owner)}">${esc(short(h.owner))}</b> · ${h.dao ? 'a DAO can also freeze it' : 'no DAO, so the owner may unfreeze'}<br>
    Status: <b data-testid="house-frozen" class="${s.frozen ? 'fail' : 'pass'}">${s.frozen ? 'frozen' : 'active'}</b>${s.frozen ? ' <span class="note">(frozen on purpose: the agent cannot spend until the owner unfreezes)</span>' : ''} · next action #${esc(s.next_action)}<br>
    Full-access keys: <b data-testid="house-fak">${h.keys.fullAccess}</b> · the agent's key may only call: <b>${esc(h.keys.functionCall.map(k => k.methods.join(',')).join(' | '))}</b></div>
  <div class="card"><b>Wallet</b> · <span data-testid="house-who">${who ? 'signed in as ' + esc(who) + (isOwner ? ' (owner)' : ' (not the owner: buttons are off)') : 'not signed in'}</span><br>
    ${who ? '<button data-act="signout">Sign out</button>' : `<button data-act="signin">Connect wallet</button> <span class="note">No testnet account? <a href="${NEW_ACCOUNT}" target="_blank" rel="noopener">Make one</a>, then get <a href="${FAUCET}" target="_blank" rel="noopener">free testnet NEAR</a>.</span>`}</div>
  <div class="card"><b>Emergency</b> · ${btn('freeze', 'Freeze the House')} ${btn('unfreeze', 'Unfreeze')}
    <p class="note">Freeze stops every agent spend at once. It is signed by your wallet, never by this page.</p></div>
  <div class="card" data-testid="house-pending"><b>Waiting for you</b> (agent spends over the cap, held by the contract with NEP-519 yield, about 200 blocks)
    ${pend.length ? `<table><tr><th>#</th><th>rule</th><th>to</th><th>amount</th><th></th></tr>${pend.map(([id, a]) => `<tr data-action="${esc(id)}"><td>${esc(id)}</td><td>${esc(a.p?.clause_id ?? a.clause_id)}</td><td title="${esc(a.p?.receiver ?? a.receiver)}">${esc(short(a.p?.receiver ?? a.receiver))}</td><td>${near(a.p?.amount ?? a.amount)}</td>
      <td>${btn('approve', 'Approve', `data-id="${esc(id)}"`)} ${btn('deny', 'Deny', `data-id="${esc(id)}"`)}</td></tr>`).join('')}</table>` : '<p class="note" data-testid="house-none">Nothing waiting.</p>'}</div>
  <div id="house-log" class="card" aria-live="polite"></div>`;
  for (const b of out.querySelectorAll('button[data-act]')) b.onclick = () => act(b).catch(e => log(`<span class="fail" data-testid="house-error">${esc(e.message)}</span>`));
}

function log(html) { const l = $('#house-log'); if (l) l.innerHTML = html + (l.innerHTML ? '<br>' + l.innerHTML : ''); }

async function call(methodName, args) {
  const w = await wallet().wallet();
  const res = await w.signAndSendTransaction({ receiverId: house.oath,
    actions: [{ type: 'FunctionCall', params: { methodName, args, gas: GAS, deposit: '0' } }] });
  return res?.transaction?.hash || res?.transaction_outcome?.id || (Array.isArray(res) ? res[0]?.transaction?.hash : null);
}

async function act(b) {
  const a = b.dataset.act;
  if (a === 'signin') { await connect(t => t && log(esc(t))); return render(); }
  if (a === 'signout') { await disconnect(); return render(); }
  b.disabled = true; log(`${esc(a)}: waiting for your wallet…`);
  const hash = a === 'freeze' ? await call('freeze', {}) : a === 'unfreeze' ? await call('unfreeze', {})
    : await call('resolve_escalation', { action_id: b.dataset.id, approve: a === 'approve' });
  log(`<span data-testid="house-done" data-act="${esc(a)}">${esc(a)} signed by your wallet: ${hash ? txl(hash) : '(no hash returned)'}</span>`);
  await new Promise(r => setTimeout(r, 2500)); await render();
}

export async function mountHouse() { wallet(); onWallet(() => render().catch(() => {})); await render(); }
window.mountHouse = mountHouse;
