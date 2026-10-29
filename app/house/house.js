// Your House: the owner governs their own charter from their own NEAR wallet (testnet).
// The page never holds a key. Wallets connect through NEAR Connect (@hot-labs/near-connect): each wallet's
// code runs in a sandboxed iframe, and every freeze / unfreeze / approve / deny is approved in the wallet, one by one.
// Sign-in asks for no access key.
import { NearConnector } from '@hot-labs/near-connect';
// Lazy: NEAR Connect only awaits this when a WalletConnect wallet is used, so the client loads on demand.
const WC_ID = __WC_ID__;
let wcP; const walletConnect = WC_ID ? { then: (ok, no) => (wcP ||= import('/wc.bundle.js').then(m => m.init(WC_ID))).then(ok, no) } : undefined;
import { injectGuest, GUEST_ID, balance, fmt, faucet, deeds, nfts, nftSupply, ARENA } from './onboard.js';
import { factoryOfCharter } from './factories.js';

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
    injectGuest(); // the one-click guest account is one more wallet in the list
    // Pass the page's CSP nonce so the wallet's sandboxed iframe may run its scripts.
    connector = new NearConnector({ network: 'testnet', features: { testnet: true, signAndSendTransaction: true }, footerBranding: null, walletConnect, cspNonce: document.querySelector('script[nonce]')?.nonce || undefined });
    // The picker's "⋯" header button has no text: name it for screen readers and hover.
    const label = r => r.querySelectorAll?.('.settings-button:not([aria-label])').forEach(b => { b.setAttribute('aria-label', 'Wallet list settings'); b.title = 'Wallet list settings'; });
    const fix = r => { label(r); unavailable(r); };
    new MutationObserver(() => { fix(document); document.querySelectorAll('body > *').forEach(e => e.shadowRoot && fix(e.shadowRoot)); }).observe(document.body, { childList: true, subtree: true });
    const ping = () => listeners.forEach(f => f());
    connector.on('wallet:signIn', ping); connector.on('wallet:signOut', ping);
    // Clear EVM label; wallets this browser already has go first.
    connector.whenManifestLoaded.then(() => {
      const evm = connector.wallets.find(w => w.manifest.id === 'ethereum-wallets');
      if (evm) evm.manifest.name = window.ethereum ? 'MetaMask & EVM wallets (detected)' : 'MetaMask & EVM wallets';
      if (evm && window.ethereum) connector.wallets = [evm, ...connector.wallets.filter(w => w !== evm)];
      // MyNearWallet's NEAR Connect script has a testnet path (testnet.mynearwallet.com), but the manifest has no testnet flag.
      // Its own site says it is deprecated on 31 Oct 2026: from then on it leaves the list and shows greyed with that reason.
      const mnw = connector.wallets.find(w => w.manifest.id === 'mynearwallet');
      if (mnw && mnwSunset()) connector.wallets = connector.wallets.filter(w => w !== mnw);
      else if (mnw) { mnw.manifest.features.testnet = true; (mnw.manifest.permissions.allowsOpen ||= []).push('https://testnet.mynearwallet.com'); mnw.manifest.name = 'MyNearWallet (testnet, ends 31 Oct)'; mnw.manifest.website = 'https://testnet.mynearwallet.com'; }
    }).catch(() => {});
  }
  return connector;
}
// Wallets people ask for that NEAR Connect does not offer on testnet. Each reason was checked in the NEAR Connect
// manifest (hot-dao/near-selector repository/manifest.json) and the wallet's own NEAR Connect script.
const UNAVAILABLE = [
  ['HOT Wallet', 'Mainnet only: its NEAR Connect script refuses testnet.'],
  ['HERE Wallet', 'Now HOT Wallet (same app), so mainnet only.'],
  ['OKX Wallet', 'Mainnet only in NEAR Connect (no testnet support listed).'],
  ['NEAR Mobile', 'Mainnet only: its NEAR Connect script refuses testnet.'],
  ['Hana Wallet', 'Mainnet only in NEAR Connect (no testnet support listed).'],
  ['Sender', 'Not in NEAR Connect.'],
  ['Bitte Wallet', 'Not in NEAR Connect.'],
];
// MyNearWallet sunset: 31 Oct 2026, 00:00 Cairo (UTC+3). Nothing else in the house flow uses it.
export const MNW_SUNSET = Date.UTC(2026, 9, 30, 21, 0, 0);
const mnwSunset = () => Date.now() >= MNW_SUNSET;
function unavailable(r) {
  r.querySelectorAll?.('.modal-body').forEach(body => {
    if (!body.querySelector('.connect-item') || body.querySelector('.nc-unavailable')) return;
    const box = document.createElement('div');
    box.className = 'nc-unavailable'; box.setAttribute('data-testid', 'wallets-unavailable');
    box.style.cssText = 'margin-top:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12)';
    const h = document.createElement('p'); h.textContent = 'Not available on testnet';
    h.style.cssText = 'margin:4px 8px;font-size:12px;opacity:.7;color:#fff';
    box.append(h);
    for (const [name, why] of mnwSunset() ? [['MyNearWallet', 'Sunset: its own site set 31 Oct 2026 as the end date.'], ...UNAVAILABLE] : UNAVAILABLE) {
      const row = document.createElement('div');
      row.setAttribute('aria-disabled', 'true'); row.title = why; row.dataset.wallet = name;
      row.style.cssText = 'display:flex;flex-direction:column;padding:6px 8px;opacity:.45;cursor:not-allowed;color:#fff';
      const a = document.createElement('span'); a.textContent = name; a.style.fontSize = '14px';
      const b = document.createElement('span'); b.textContent = why; b.style.fontSize = '12px';
      row.append(a, b); box.append(row);
    }
    body.append(box);
  });
}
export function onWallet(f) { listeners.add(f); }
export async function account() {
  // A wallet picked earlier but never finished (e.g. a WalletConnect QR left open) must not hold the HUD forever.
  const slow = new Promise(r => setTimeout(() => r(null), 12000));
  try { const { accounts } = await Promise.race([wallet().getConnectedWallet(), slow.then(() => ({}))]); return accounts?.[0]?.accountId || null; } catch { return null; }
}
// Opens the wallet list, then signs in. `note` gets plain-text progress and errors (never swallowed).
export async function connect(note = () => {}) {
  const c = wallet();
  let id;
  try { id = await c.selectWallet(); } catch { note(''); return account(); }
  if (id === 'ethereum-wallets') note('In the evm-on-near.dev window that opens, press Connect Wallet, then MetaMask, and approve in MetaMask (it adds NEAR Protocol Testnet, chain 398). If no window opened, allow pop-ups for this site.');
  else if (id === 'nightly-wallet' && !window.nightly) note('Nightly is not installed in this browser. Install it from the Chrome Web Store (chromewebstore.google.com/detail/nightly/fiikommddbeccaoicoejoniammnalkfa), reload this page and press Connect again. No extension? Press Start free.');
  else if (id === 'near-cli') note('NEAR CLI: type your testnet account id in the window, then run the near command it shows in your terminal (needs near-cli-rs installed).');
  else note('Waiting for your wallet…');
  try { await c.connect({ walletId: id }); note(''); }
  catch (e) { note(`Could not connect: ${e?.message || e}`); throw e; }
  return account();
}
/** One click: a new testnet account with 10 NEAR from the public faucet; its key stays in this browser. */
export async function startGuest(note = () => {}) {
  note('Making your free testnet account with 10 NEAR (up to a minute)…');
  try { await wallet().connect({ walletId: GUEST_ID }); note(''); }
  catch (e) { note(`Could not make the guest account: ${e?.message || e}`); throw e; }
  return account();
}
export async function disconnect() { await wallet().disconnect().catch(() => {}); }

// A small "Connect wallet" control for any page (the town uses it).
export async function mountConnect(el) {
  let msg;
  const draw = async () => {
    const who = await account();
    const [bal, mine] = who ? await Promise.all([balance(who), deeds(who)]) : [null, []];
    const low = who && bal != null && bal < 10n ** 24n;
    // A house built a moment ago can lag on the RPC node: look again a few times.
    if (who && !mine.length && (draw.n = (draw.n || 0) + 1) < 6) setTimeout(draw, 6000);
    el.innerHTML = who
      ? `<a class="pill" href="/console#house" title="${esc(who)}" data-testid="hud-account">${esc(short(who))} · ${fmt(bal)} NEAR</a>`
        + (mine.length ? `<a class="pill" href="/shops/vault/" data-testid="hud-deed" title="Your house deed in the charter factory">Your house: ${esc(short(mine[0]))}</a>`
          : `<a class="pill go" href="/shops/vault/" data-testid="hud-build" title="Creates your own charter account: the house that keeps your rules">Build my house</a>`)
        + (low ? '<button type="button" class="pill go" data-x="drip" data-testid="hud-faucet" title="10 NEAR from the public testnet faucet, sent to this account">Get 10 free testnet NEAR</button>' : '')
        + '<button type="button" class="pill" data-x="out">Sign out</button>'
      : `<button type="button" class="pill go" data-x="guest" data-testid="hud-guest" title="Makes a new testnet account with 10 free NEAR. Its key stays in this browser.">Start free</button><button type="button" class="pill" data-x="in">Connect wallet</button>`;
    if (!msg) { msg = document.createElement('div'); msg.dataset.testid = 'wallet-note'; msg.setAttribute('role', 'status'); msg.style.cssText = 'flex-basis:100%;max-width:360px;font-size:12px;line-height:1.35;margin-top:4px;background:#2a1d14ee;color:#fbe9d0;padding:6px 8px;border-radius:8px'; }
    el.appendChild(msg);
    const note = t => { msg.innerHTML = t; msg.hidden = !t; };
    msg.hidden = !msg.textContent;
    const on = (x, f) => el.querySelector(`[data-x="${x}"]`)?.addEventListener('click', e => { e.currentTarget.disabled = true; f().then(draw).catch(() => draw()); });
    // After a sign-in, tell the town (it flies to the House and opens /shops/vault/#create).
    const told = a => { if (a) dispatchEvent(new CustomEvent('nearcarta:signin', { detail: { accountId: a } })); return a; };
    on('in', () => connect(t => note(esc(t))).then(told));
    on('guest', () => startGuest(t => note(esc(t))).then(told));
    on('drip', async () => { try { const h = await faucet(who, t => note(esc(t))); note(`10 testnet NEAR sent: ${txl(h)}`); } catch (e) { note(esc('Faucet: ' + e.message)); } });
    on('out', () => disconnect());
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
    ${who ? '<button data-act="signout">Sign out</button>' : `<button data-act="signin">Connect wallet</button> <button data-act="guest">Start free (guest account, 10 testnet NEAR)</button>`}</div>
  <div class="card" data-testid="house-deed"><b>Your own house</b> · ${await deedCard(who)}</div>
  <div class="card"><b>Emergency</b> · ${btn('freeze', 'Freeze the House')} ${btn('unfreeze', 'Unfreeze')}
    <p class="note">Freeze stops every agent spend at once. It is signed by your wallet, never by this page.</p></div>
  <div class="card" data-testid="house-pending"><b>Waiting for you</b> (agent spends over the cap, held by the contract with NEP-519 yield, about 200 blocks)
    ${pend.length ? `<table><tr><th>#</th><th>rule</th><th>to</th><th>amount</th><th></th></tr>${pend.map(([id, a]) => `<tr data-action="${esc(id)}"><td>${esc(id)}</td><td>${esc(a.p?.clause_id ?? a.clause_id)}</td><td title="${esc(a.p?.receiver ?? a.receiver)}">${esc(short(a.p?.receiver ?? a.receiver))}</td><td>${near(a.p?.amount ?? a.amount)}</td>
      <td>${btn('approve', 'Approve', `data-id="${esc(id)}"`)} ${btn('deny', 'Deny', `data-id="${esc(id)}"`)}</td></tr>`).join('')}</table>` : '<p class="note" data-testid="house-none">Nothing waiting.</p>'}</div>
  <div id="house-log" class="card" aria-live="polite"></div>`;
  for (const b of out.querySelectorAll('button[data-act]')) b.onclick = () => act(b).catch(e => log(`<span class="fail" data-testid="house-error">${esc(e.message)}</span>`));
}

// The deed (factory registry entry) and NEP-171 Guardian NFTs for the signed-in account.
async function deedCard(who) {
  if (!who) return '<span class="note">Sign in (or Start free) to build a house of your own.</span>';
  const [d, t, n] = await Promise.all([deeds(who), nfts(who), nftSupply()]);
  const acc = a => `<a href="https://testnet.nearblocks.io/address/${esc(a)}" target="_blank" rel="noopener">${esc(short(a))}</a>`;
  return (d.length ? `deed${d.length > 1 ? 's' : ''}: ${d.map(acc).join(', ')} <span class="note">(registered in the charter factory ${esc([...new Set(d.map(factoryOfCharter))].join(', '))})</span>`
      : `no house yet. <a class="pill go" href="/shops/vault/" data-testid="house-build">Build my house</a> <span class="note">One approval: the factory creates your charter account and writes your deed.</span>`)
    + `<br>Guardian NFTs (NEP-171 on ${acc(ARENA)}): you hold <b data-testid="house-nfts">${t.length}</b>${t.length ? ' · ' + t.map(x => esc(x.metadata?.title || x.token_id)).join(', ') : ''}${n ? ` of ${esc(n)} minted` : ''}.`
    + '<br><span class="note">The house deed is the factory registry entry today, not a NEP-171 token.</span>';
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
  if (a === 'guest') { await startGuest(t => t && log(esc(t))); return render(); }
  b.disabled = true; log(`${esc(a)}: waiting for your wallet…`);
  const hash = a === 'freeze' ? await call('freeze', {}) : a === 'unfreeze' ? await call('unfreeze', {})
    : await call('resolve_escalation', { action_id: b.dataset.id, approve: a === 'approve' });
  log(`<span data-testid="house-done" data-act="${esc(a)}">${esc(a)} signed by your wallet: ${hash ? txl(hash) : '(no hash returned)'}</span>`);
  await new Promise(r => setTimeout(r, 2500)); await render();
}

export async function mountHouse() { wallet(); onWallet(() => render().catch(() => {})); await render(); }
window.mountHouse = mountHouse;
export { faucet, balance } from './onboard.js';
