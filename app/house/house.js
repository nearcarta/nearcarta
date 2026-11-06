// Your House: the owner governs their own charter from their own NEAR wallet.
// The page never holds a key. Wallets connect through NEAR Connect (@hot-labs/near-connect): each wallet's
// code runs in a sandboxed iframe, and every freeze / unfreeze / approve / deny is approved in the wallet, one by one.
// On mainnet, sign-in asks for a function-call key on the board (propose and propose_call, gas only).
// https://docs.near.org/web3-apps/tutorials/wallet-login
import { NearConnector } from '@hot-labs/near-connect';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };
import { AGENT_METHODS, GAS_TOPUP_YOCTO } from '../../shared/board/session.js';
import { createBoardKeyPlugin } from './board-key.js';
import { addPrivy, NEAR_NET } from './privy.js';
import { decoratePicker } from '../shops/vault/picker.js';
// Lazy: NEAR Connect only awaits this when a WalletConnect wallet is used, so the client loads on demand.
const WC_ID = __WC_ID__;
let wcP; const walletConnect = WC_ID ? { then: (ok, no) => (wcP ||= import('/wc.bundle.js').then(m => m.init(WC_ID))).then(ok, no) } : undefined;
import { balance, fmt, deeds, nfts, nftSupply, ARENA, DEED, deedHouses, deedMinted } from './onboard.js';
import { factoryOfCharter } from './factories.js';
import { clearSessionAccount, readSession, sessionAccount, sessionPill, writeSession } from '../design/D8_shops/js/session.js';
import { deedMarkup } from '../src/panels/deed.js';

const API = (window.NEARCARTA_API || '').replace(/\/$/, '');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const txl = h => `<a data-testid="house-tx" href="https://nearblocks.io/txns/${esc(h)}" target="_blank" rel="noopener">${esc(String(h).slice(0, 10))}…</a>`;
const near = y => (y == null ? '–' : (Number(BigInt(y) / 10n ** 18n) / 1e6).toString() + ' NEAR');
const short = a => { const s = String(a ?? ''); return s.length > 28 ? s.slice(0, 12) + '…' + s.slice(-10) : s; };
export const FAUCET = 'https://docs.near.org/getting-started/faucet';
export const NEW_ACCOUNT = 'https://docs.near.org/getting-started/create-account';
const GAS = '50000000000000';
let connector, house;
const listeners = new Set();

const connectors = new Map();
let watched = false;
function connectorFor(network) {
  if (connectors.has(network)) return connectors.get(network);
  decoratePicker();
  const c = new NearConnector({ network, features: { [network]: true, signAndSendTransaction: true }, footerBranding: null, walletConnect, cspNonce: document.querySelector('script[nonce]')?.nonce || undefined });
  if (network === 'mainnet') {
    c.__boardKey = c.use(createBoardKeyPlugin({
      contractId: MAIN.board.contract, methodNames: AGENT_METHODS, allowance: GAS_TOPUP_YOCTO,
    })).catch(() => {});
  }
  connectors.set(network, c);
  if (!connector && network === NEAR_NET) connector = c;
  // The picker's "⋯" header button has no text: name it for screen readers and hover.
  const label = r => r.querySelectorAll?.('.settings-button:not([aria-label])').forEach(b => { b.setAttribute('aria-label', 'Wallet list settings'); b.title = 'Wallet list settings'; });
  const fix = r => { label(r); };
  if (!watched) {
    watched = true;
    new MutationObserver(() => { fix(document); document.querySelectorAll('body > *').forEach(e => e.shadowRoot && fix(e.shadowRoot)); }).observe(document.body, { childList: true, subtree: true });
  }
  addPrivy(c).catch(() => {});
  const ping = () => listeners.forEach(f => f());
  c.on('wallet:signIn', ping); c.on('wallet:signOut', ping);
  // Clear EVM label; wallets this browser already has go first.
  c.whenManifestLoaded.then(() => {
    const evm = c.wallets.find(w => w.manifest.id === 'ethereum-wallets');
    if (evm) evm.manifest.name = window.ethereum ? 'MetaMask & EVM wallets (detected)' : 'MetaMask & EVM wallets';
    if (evm && window.ethereum) c.wallets = [evm, ...c.wallets.filter(w => w !== evm)];
  }).catch(() => {});
  return c;
}
export function wallet() { return connectorFor(NEAR_NET); }
/** Mainnet wallets for the default setup path. No guest faucet is injected here. */
export function mainnetWallet() { return connectorFor('mainnet'); }
export const MNW_SUNSET = Date.UTC(2026, 9, 30, 21, 0, 0);
export function onWallet(f) { listeners.add(f); }
async function accountOf(c) {
  // A wallet picked earlier but never finished (e.g. a WalletConnect QR left open) must not hold the HUD forever.
  const slow = new Promise(r => setTimeout(() => r(null), 12000));
  try { const { accounts } = await Promise.race([c.getConnectedWallet(), slow.then(() => ({}))]); return accounts?.[0]?.accountId || null; } catch { return null; }
}
export async function account() { return accountOf(wallet()); }
export async function mainnetAccount() { return accountOf(mainnetWallet()); }
// Opens the wallet list, then signs in. `note` gets plain-text progress and errors (never swallowed).
export function readyBoardKey() { return mainnetWallet().__boardKey || Promise.resolve(); }
export async function connect(note = () => {}, network = NEAR_NET) {
  const c = network === 'mainnet' ? mainnetWallet() : wallet();
  if (network === 'mainnet') await readyBoardKey();
  const main = network === 'mainnet';
  let id;
  try { id = await c.selectWallet(); } catch { note(''); return accountOf(c); }
  if (id === 'ethereum-wallets') note('In the evm-on-near.dev window that opens, press Connect Wallet, then MetaMask, and approve in MetaMask (it adds NEAR on mainnet). If no window opened, allow pop-ups for this site.');
  else if (id === 'nightly-wallet' && !window.nightly) note('Nightly is not installed in this browser. Install it from the Chrome Web Store (chromewebstore.google.com/detail/nightly/fiikommddbeccaoicoejoniammnalkfa), reload this page and press Sign in again.');
  else if (id === 'near-cli') note('NEAR CLI: type your mainnet account id in the window, then run the near command it shows in your terminal (needs near-cli-rs installed).');
  else note('Waiting for your wallet…');
  try { await c.connect({ walletId: id }); note(''); }
  catch (e) { note(`Could not connect: ${e?.message || e}`); throw e; }
  const account = await accountOf(c);
  if (account) writeSession({ accountId: account, walletId: id, displayName: readSession().displayName || '' });
  return account;
}
/** A short look at the wallet. A full reload starts a new connector, so this is the silent restore. */
export async function peekAccount(timeoutMs = 1500) {
  const c = mainnetWallet();
  const slow = new Promise(r => setTimeout(() => r(null), timeoutMs));
  try {
    const got = await Promise.race([c.getConnectedWallet(), slow.then(() => ({}))]);
    return got?.accounts?.[0]?.accountId || null;
  } catch { return null; }
}
/** One click reconnects the wallet id saved with the session. */
export async function restoreWallet() {
  const saved = readSession();
  const walletId = typeof saved.walletId === 'string' ? saved.walletId : '';
  const live = await peekAccount(1500);
  if (live) { writeSession({ accountId: live, walletId, displayName: saved.displayName || '' }); return live; }
  if (!walletId) return null;
  await readyBoardKey();
  await mainnetWallet().connect({ walletId });
  const id = await peekAccount(4000);
  if (id) writeSession({ accountId: id, walletId, displayName: saved.displayName || '' });
  return id;
}
export async function startGuest() { return null; }
export async function disconnect() { await wallet().disconnect().catch(() => {}); }

// A small "Connect wallet" control for any page (the town uses it).
export async function mountConnect(el) {
  let msg;
  const draw = async () => {
    const storedNow = readSession();
    const who = (await Promise.race([mainnetAccount(), new Promise(r => setTimeout(() => r(null), 1500))])) || sessionAccount(storedNow) || null;
    const [bal, mine] = who ? await Promise.all([balance(who), deeds(who).catch(() => [])]) : [null, []];
    const low = who && bal != null && bal < 10n ** 24n;
    // A house built a moment ago can lag on the RPC node: look again a few times.
    if (who && !mine.length && (draw.n = (draw.n || 0) + 1) < 6) setTimeout(draw, 6000);
    let hero = '';
    try { hero = JSON.parse(localStorage.getItem('nearcarta.hero.v1') || 'null')?.name || ''; } catch { /* keep the short id */ }
    const stored = readSession();
    const id = who || sessionAccount(stored);
    const balanceNear = bal == null ? stored.balanceNear : (bal === 0n ? 0 : fmt(bal));
    if (who) writeSession({ accountId: who, displayName: hero || stored.displayName || '', balanceNear });
    dispatchEvent(new CustomEvent('nearcarta:balance', { detail: { balanceNear } }));
    const label = sessionPill({ accountId: id, displayName: hero || stored.displayName || '', balanceNear });
    const restore = !who && id
      ? '<button type="button" class="pill go" data-x="restore" data-testid="restore-session">Restore session</button>'
      : '';
    el.innerHTML = id
      ? `<a class="pill${bal === 0n ? ' go' : ''}" href="/setup/#fund" title="${esc(id)}" data-testid="hud-account">${esc(label)}</a>`
        + restore
        + '<button type="button" class="pill" data-x="out">Sign out</button>'
      : `<a class="pill go" href="/setup/" data-testid="hud-connect" title="Sign in, then fund your account">Sign in</a>`;
    if (!msg) { msg = document.createElement('div'); msg.dataset.testid = 'wallet-note'; msg.setAttribute('role', 'status'); msg.style.cssText = 'flex-basis:100%;max-width:360px;font-size:12px;line-height:1.35;margin-top:4px;background:#2a1d14ee;color:#fbe9d0;padding:6px 8px;border-radius:8px'; }
    el.appendChild(msg);
    const note = t => { msg.innerHTML = t; msg.hidden = !t; };
    msg.hidden = !msg.textContent;
    const on = (x, f) => el.querySelector(`[data-x="${x}"]`)?.addEventListener('click', e => { e.currentTarget.disabled = true; f().then(draw).catch(() => draw()); });
    // After a sign-in, tell the town (it flies to the House and opens /shops/vault/#create).
    const told = a => { if (a) dispatchEvent(new CustomEvent('nearcarta:signin', { detail: { accountId: a } })); return a; };
    on('in', () => connect(t => note(esc(t))).then(told));
    on('restore', () => restoreWallet().then(told));
    on('guest', () => Promise.resolve(null));
    on('out', () => { clearSessionAccount(); return disconnect(); });
  };
  onWallet(draw);
  addEventListener('nearcarta:tx', () => { draw().catch(() => {}); });
  await draw();
}

async function load() {
  const r = await fetch(API + '/api/house'); house = await r.json();
  if (!r.ok) throw new Error(house.error || 'http ' + r.status);
  return house;
}

async function render() {
  const out = $('#house .out');
  const h = await load();
  if (h?.kind === 'deed') {
    out.innerHTML = `${deedMarkup()}<div class="house-empty" data-testid="house-empty" role="status"><p>This record is the public deed. It is not your charter row.</p><p>Your row is read with get_charter on the house shop. Nothing was signed.</p></div>`;
    return;
  }
  const who = await account();
  const s = h?.state || {};
  const keys = h?.keys || {};
  const pend = Object.entries(h?.actions || {}).filter(([, a]) => a?.status === 'escalated');
  const isOwner = who && who === h?.owner;
  const btn = (act, label, extra = '') => `<button data-act="${act}" ${extra} ${isOwner ? '' : 'disabled'}>${label}</button>`;
  out.innerHTML = `${deedMarkup()}<div class="card" data-testid="house-state">House <span title="${esc(h?.oath)}">${esc(short(h?.oath))}</span> · owner <b title="${esc(h?.owner)}">${esc(short(h?.owner))}</b> · The owner may freeze and unfreeze this house.<br>
    Status: <b data-testid="house-frozen" class="${s.frozen ? 'fail' : 'pass'}">${s.frozen ? 'frozen' : 'active'}</b>${s.frozen ? ' <span class="note">(frozen on purpose: the agent cannot spend until the owner unfreezes)</span>' : ''} · next action #${esc(s.next_action)}<br>
    Full-access keys: <b data-testid="house-fak">${keys.fullAccess ?? 0}</b> · the agent's key may call: <b>${esc((keys.functionCall || []).map(k => (k.methods || []).join(',')).join(' | ') || 'propose and propose_batch')}</b></div>
  <div class="card"><b>Wallet</b> · <span data-testid="house-who">${who ? 'signed in as ' + esc(who) + (isOwner ? ' (owner)' : ' (not the owner: buttons are off)') : 'not signed in'}</span><br>
    ${who ? '<button data-act="signout">Sign out</button>' : `<a class="pill go" href="/setup/" data-testid="house-signin">Sign in</a>`}</div>
  <div class="card" data-testid="house-deed"><b>Your own house</b> · ${await deedCard(who)}</div>
  <div class="card"><b>Emergency</b> · ${btn('freeze', 'Freeze the House')} ${btn('unfreeze', 'Unfreeze')}
    <p class="note">Freeze stops every agent spend at once. It is signed by your wallet, never by this page.</p></div>
  <div class="card" data-testid="house-pending"><b>Waiting for you</b> (agent spends over the cap, held by the contract with NEP-519 yield, about 200 blocks)
    ${pend.length ? `<table><tr><th>#</th><th>rule</th><th>to</th><th>amount</th><th></th></tr>${pend.map(([id, a]) => `<tr data-action="${esc(id)}"><td>${esc(id)}</td><td>${esc(a.p?.clause_id ?? a.clause_id)}</td><td title="${esc(a.p?.receiver ?? a.receiver)}">${esc(short(a.p?.receiver ?? a.receiver))}</td><td>${near(a.p?.amount ?? a.amount)}</td>
      <td>${btn('approve', 'Approve', `data-id="${esc(id)}"`)} ${btn('deny', 'Deny', `data-id="${esc(id)}"`)}</td></tr>`).join('')}</table>` : '<p class="note" data-testid="house-none">Nothing waiting.</p>'}</div>
  <div id="house-log" class="card" aria-live="polite"></div>`;
  for (const b of out.querySelectorAll('button[data-act]')) b.onclick = () => act(b).catch(e => log(`<span class="fail" data-testid="house-error">${esc(e.message)}</span>${e.html || ''}`));
}

// The house deed (NEP-171 v2: the deed holds the house purse), the charter registry entry and Guardian NFTs.
async function deedCard(who) {
  if (!who) return '<span class="note">Sign in to build a house of your own.</span>';
  const [d, t, n, held, minted] = await Promise.all([deeds(who), nfts(who), nftSupply(), deedHouses(who), deedMinted(who)]);
  const acc = a => `<a href="https://nearblocks.io/address/${esc(a)}" target="_blank" rel="noopener">${esc(short(a))}</a>`;
  const houses = held.map(h => `<div class="deed" data-testid="deed-house" data-token="${esc(h.token_id)}">
      <b>${esc(h.metadata?.title || h.token_id)}</b> · purse <b data-testid="deed-purse">${near(h.purse?.balance)}</b> · rule: at most <b>${near(h.purse?.cap)}</b> per payment · paid ${near(h.purse?.paid)} in ${esc(h.purse?.pays ?? 0)}
      <br><label>Pay to <input data-f="to" placeholder="account.near" maxlength="64" aria-label="Pay to account"></label>
      <label>NEAR <input data-f="amt" type="number" min="0.001" step="0.001" value="0.01" aria-label="Amount in NEAR"></label>
      <button data-act="deed-pay" data-token="${esc(h.token_id)}" data-testid="deed-pay">Pay from the house</button>
      <button data-act="deed-fund" data-token="${esc(h.token_id)}" data-testid="deed-fund">Add 0.05 NEAR</button>
      <br><label>Give the house to <input data-f="give" placeholder="account.near" maxlength="64" aria-label="Give the deed to account"></label>
      <button data-act="deed-give" data-token="${esc(h.token_id)}" data-testid="deed-give">Give deed</button>
      <span class="note">Whoever holds this deed controls the purse. Give it away and your wallet is refused from then on.</span></div>`).join('');
  return `<div data-testid="deed-v2">House deed (NEP-171 on ${acc(DEED)}): ${held.length ? houses
      : minted ? '<span class="note">you gave your deed away, so its purse is no longer yours.</span>'
      : `none yet. <button data-act="deed-mint" data-testid="deed-mint">Mint my deed with 0.1 NEAR in its purse</button> <span class="note">One approval. 0.02 NEAR pays storage; the rest is the house purse, spendable only by the deed holder, 0.05 NEAR per payment at most.</span>`}</div>`
    + (d.length ? `Charter${d.length > 1 ? 's' : ''}: ${d.map(acc).join(', ')} <span class="note">(registered in the charter factory ${esc([...new Set(d.map(factoryOfCharter))].join(', '))})</span>`
      : `No charter yet. <a class="pill go" href="/shops/vault/" data-testid="house-build">Build my house</a> <span class="note">One approval: the factory creates your charter account.</span>`)
    + `<br>Guardian NFTs (NEP-171 on ${acc(ARENA)}): you hold <b data-testid="house-nfts">${t.length}</b>${t.length ? ' · ' + t.map(x => esc(x.metadata?.title || x.token_id)).join(', ') : ''}${n ? ` of ${esc(n)} minted` : ''}.`;
}

const ACC = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const yocto = n => (BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n).toString();
async function deedCall(methodName, args, deposit) {
  const w = await wallet().wallet();
  const res = await w.signAndSendTransaction({ receiverId: DEED, actions: [{ type: 'FunctionCall', params: { methodName, args, gas: GAS, deposit } }] });
  const hash = res?.transaction?.hash || res?.transaction_outcome?.id || (Array.isArray(res) ? res[0]?.transaction?.hash : null);
  const fail = res?.status?.Failure || res?.receipts_outcome?.find(o => o.outcome?.status?.Failure)?.outcome.status.Failure;
  if (fail) { const m = JSON.stringify(fail).match(/Smart contract panicked: ([^"\\]+)/); const e = new Error('refused on chain: ' + (m ? m[1] : 'failed')); e.hash = hash; throw e; }
  return hash;
}
async function deedAct(b) {
  const a = b.dataset.act, box = b.closest('.deed'), f = k => box?.querySelector(`[data-f="${k}"]`)?.value.trim();
  if (a === 'deed-mint') return deedCall('mint_deed', { house: null, cap: yocto(0.05) }, yocto(0.12));
  if (a === 'deed-fund') return deedCall('house_fund', { token_id: b.dataset.token }, yocto(0.05));
  if (a === 'deed-pay') { const to = f('to'), amt = Number(f('amt')); if (!ACC.test(to || '')) throw new Error('enter the account to pay'); if (!(amt > 0)) throw new Error('enter an amount');
    return deedCall('house_pay', { token_id: b.dataset.token, receiver_id: to, amount: yocto(amt) }, '1'); }
  if (a === 'deed-give') { const to = f('give'); if (!ACC.test(to || '')) throw new Error('enter the account to give the deed to');
    if (!confirm(`Give this house and its purse to ${to}? You cannot take it back.`)) throw new Error('cancelled');
    return deedCall('nft_transfer', { receiver_id: to, token_id: b.dataset.token }, '1'); }
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
  if (a.startsWith('deed-')) {
    try { const h = await deedAct(b); log(`<span data-testid="deed-done" data-act="${esc(a)}">${esc(a.slice(5))} done on chain: ${h ? txl(h) : '(no hash returned)'}</span>`); }
    catch (e) { b.disabled = false; throw Object.assign(new Error(e.message), { html: e.hash ? ' ' + txl(e.hash) : '' }); }
    await new Promise(r => setTimeout(r, 2500)); return render();
  }
  const hash = a === 'freeze' ? await call('freeze', {}) : a === 'unfreeze' ? await call('unfreeze', {})
    : await call('resolve_escalation', { action_id: b.dataset.id, approve: a === 'approve' });
  log(`<span data-testid="house-done" data-act="${esc(a)}">${esc(a)} signed by your wallet: ${hash ? txl(hash) : '(no hash returned)'}</span>`);
  await new Promise(r => setTimeout(r, 2500)); await render();
}

export async function mountHouse() { wallet(); onWallet(() => render().catch(() => {})); await render(); }
window.mountHouse = mountHouse;
export { balance } from './onboard.js';
