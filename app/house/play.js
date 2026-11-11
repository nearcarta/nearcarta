// Market Day for real, with no popup and no gas: an email code logs the visitor in to Privy inline,
// Privy makes their NEAR wallet (an implicit account), the relayer opens it with a few thousandths of a
// NEAR and a market storage deposit, and every move after that is a NEP-366 delegate action the wallet
// signs silently (Privy raw sign, inside Privy's hidden iframe) and the relayer sends and pays for.
// The relayer only accepts zero-deposit market moves, so this wallet key can spend no NEAR through it.
import { Buffer } from 'buffer';
globalThis.Buffer = globalThis.Buffer || Buffer;
import Privy, { LocalStorage, create as createWallet, rawSign } from '@privy-io/js-sdk-core';
import { Signer, PublicKey, actions, buildDelegateAction, encodeSignedDelegate } from 'near-api-js';
import bs58 from 'bs58';

// The network answer, published by shared/net/net.js (a /shared/net/net.js module the page loads).
// A fallback keeps this bundle working if it is loaded before that module.
const NETCFG = () => globalThis.NEARCARTA_NET || { net: 'mainnet', explorer: 'https://nearblocks.io', apiPath: '/api' };
const MARKET = () => (globalThis.NEARCARTA_NET?.market || (NETCFG().net === 'testnet' ? 'arena.nearcarta.testnet' : 'arena.nearcarta.near'));
const RPC = () => (NETCFG().net === 'testnet' ? 'https://rpc.testnet.fastnear.com' : 'https://free.rpc.fastnear.com');
const TG = 10n ** 12n;
const API = () => (typeof window !== 'undefined' && window.NEARCARTA_API) || '';
const privy = new Privy({ appId: __PRIVY_APP_ID__, ...(__PRIVY_CLIENT_ID__ ? { clientId: __PRIVY_CLIENT_ID__ } : {}), storage: new LocalStorage() });
const isNear = (a) => a?.type === 'wallet' && a.chain_type === 'near' && typeof a.address === 'string';

async function rpc(method, params) {
  const r = await fetch(RPC(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.cause?.name || j.error.name || 'rpc'); return j.result;
}
export async function view(method, args = {}, contract = MARKET()) {
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  return JSON.parse(Buffer.from(r.result).toString());
}

// Privy's hidden iframe holds the wallet's signing session. Nothing is shown.
let frame = null;
function mountFrame() {
  if (frame) return frame;
  frame = new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.src = privy.embeddedWallet.getURL(); f.style.display = 'none'; f.setAttribute('aria-hidden', 'true'); f.title = 'wallet';
    addEventListener('message', (e) => { if (e.source === f.contentWindow) privy.embeddedWallet.onMessage(e.data); });
    f.addEventListener('load', () => { privy.setMessagePoster({ postMessage: (m, o, t) => f.contentWindow.postMessage(m, o, t ? [t] : undefined), reload: () => { f.src = privy.embeddedWallet.getURL(); } }); resolve(); }, { once: true });
    document.body.appendChild(f);
  });
  return frame;
}

let wallet = null;
async function nearWallet(user) {
  let w = (user?.linked_accounts || []).find(isNear);
  if (!w) {
    await createWallet({ fetchPrivyRoute: privy.fetchPrivyRoute.bind(privy), getCompiledPath: privy.getCompiledPath.bind(privy), app: { appId: privy.app.appId } }, { request: { chain_type: 'near' } });
    const { user: u } = await privy.user.get(); w = (u?.linked_accounts || []).find(isNear);
  }
  if (!w) throw new Error('No wallet was made. Try again.');
  wallet = { id: w.id, address: w.address };
  return wallet.address;
}

/** Already signed in on this device? Returns the account id or null. */
export async function current() {
  try { const { user } = await privy.user.get(); if (!user) return null; return await nearWallet(user); } catch { return null; }
}
export async function sendCode(email) { await privy.auth.email.sendCode(String(email).trim()); }
export async function login(email, code) { const r = await privy.auth.email.loginWithCode(String(email).trim(), String(code).trim()); return nearWallet(r.user); }
export async function logout() { wallet = null; await privy.auth.logout().catch(() => {}); }

class PrivySigner extends Signer {
  async getPublicKey() { return PublicKey.fromString('ed25519:' + bs58.encode(Uint8Array.from(wallet.address.match(/../g).map((h) => parseInt(h, 16))))); }
  async signBytes(bytes) {
    await mountFrame();
    const hash = '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const { data } = await rawSign(privy, (o) => privy.embeddedWallet.signWithUserSigner(o), { wallet_id: wallet.id, params: { hash } });
    const hex = data.signature.replace(/^0x/, '');
    return Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
  }
}

async function post(path, body) {
  const r = await fetch(API() + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw Object.assign(new Error(j.why || j.error || `http ${r.status}`), { code: j.why, res: j }); return j;
}

/** First visit: the relayer opens the wallet and pays its market storage. Safe to call again. */
export async function ensureSession() {
  if (!wallet) throw new Error('Sign in first.');
  return post((globalThis.NEARCARTA_NET?.apiPath || '/api') + '/relay/session', { account_id: wallet.address });
}

/** One move (or up to three in one go) on the market, signed silently and sent by the relayer. */
export async function move(calls) {
  if (!wallet) throw new Error('Sign in first.');
  const list = Array.isArray(calls) ? calls : [calls];
  const signer = new PrivySigner(); const pk = await signer.getPublicKey();
  const [key, block] = await Promise.all([
    rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: wallet.address, public_key: pk.toString() }),
    rpc('block', { finality: 'final' }),
  ]);
  const da = buildDelegateAction({
    senderId: wallet.address, receiverId: MARKET(), publicKey: pk, nonce: BigInt(key.nonce) + 1n, maxBlockHeight: BigInt(block.header.height) + 200n,
    actions: list.map((c) => actions.functionCall(c.method, c.args || {}, (c.tgas ? BigInt(c.tgas) : 30n) * TG, 0n)),
  });
  const { signedDelegate } = await signer.signDelegateAction(da);
  return post((globalThis.NEARCARTA_NET?.apiPath || '/api') + '/relay', { signed_delegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64') });
}

export const account = () => wallet?.address || null;
