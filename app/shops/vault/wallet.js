// Wallet layer for the charter shop: NEAR Connect (testnet) plus an optional guest wallet.
// The guest wallet is a fresh testnet account from the public faucet. Its key is made in this
// browser and stays in this browser's localStorage; the backend never sees it. Testnet only.
import { NearConnector } from '@hot-labs/near-connect';
import { decoratePicker } from './picker.js';
import { keyFrom, functionCall, signTx, outcomeOf } from '../../../shared/vault/tx.js';

const FAUCET = 'https://helper.nearprotocol.com/account';
const GUEST_ID = 'nearcarta-guest';
const LS = 'nearcarta.vault.guest';

function transferAction(deposit) { const b = new Uint8Array(17); b[0] = 3; let v = BigInt(deposit); for (let i = 1; i < 17; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; }

function toBorsh(a) {
  const t = a.type, p = a.params || {};
  if (t === 'FunctionCall') return functionCall(p.methodName, p.args || {}, BigInt(p.gas || 30_000_000_000_000n), BigInt(p.deposit || 0));
  if (t === 'Transfer') return transferAction(p.deposit);
  throw new Error('guest wallet signs only FunctionCall and Transfer');
}

export function guestWallet(rpc) {
  const saved = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } };
  async function send({ receiverId, actions }) {
    const g = saved(); if (!g) throw new Error('no guest account in this browser');
    const key = keyFrom(g.secret);
    const ak = await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: g.accountId, public_key: key.publicKey });
    const s = signTx({ key, signerId: g.accountId, receiverId, nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash, actions: actions.map(toBorsh) });
    const r = await rpc('send_tx', { signed_tx_base64: s.base64, wait_until: 'FINAL' });
    const o = outcomeOf(r); if (!o.ok) throw Object.assign(new Error(o.error), { tx: s.hash });
    return { ...r, transaction: { ...(r.transaction || {}), hash: s.hash } };
  }
  return {
    manifest: { id: GUEST_ID, name: 'Guest testnet account', version: '1.0.0', type: 'injected', description: 'A fresh testnet account from the faucet. Key stays in this browser.',
      icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#d6b46a"/><path d="M9 21V11h3l8 7v-7h3v10h-3l-8-7v7z" fill="#1f1a15"/></svg>'),
      website: '', platform: {}, permissions: {},
      features: { signMessage: false, signTransaction: false, signAndSendTransaction: true, signAndSendTransactions: true, signInWithoutAddKey: true, verifyOwner: false, testnet: true, mainnet: false } },
    async signIn() { let g = saved(); if (!g) g = await createGuest(rpc); return [{ accountId: g.accountId, publicKey: keyFrom(g.secret).publicKey }]; },
    async signInAndSignMessage() { throw new Error('not supported by the guest wallet'); },
    async signOut() {},
    async getAccounts() { const g = saved(); return g ? [{ accountId: g.accountId, publicKey: keyFrom(g.secret).publicKey }] : []; },
    signAndSendTransaction: send,
    async signAndSendTransactions({ transactions }) { const out = []; for (const t of transactions) out.push(await send(t)); return out; },
    async signMessage() { throw new Error('not supported by the guest wallet'); },
    async signDelegateActions() { throw new Error('not supported by the guest wallet'); },
  };
}

export function hasGuest() { return !!localStorage.getItem(LS); }
export function forgetGuest() { localStorage.removeItem(LS); }

async function createGuest(rpc) {
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
  const accountId = `ncguest-${rnd}.testnet`;
  const key = keyFrom();
  const r = await fetch(FAUCET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.publicKey }) });
  if (!r.ok) throw new Error('testnet faucet said ' + r.status + '. Try again in a minute, or connect a wallet.');
  for (let i = 0; i < 30; i++) {
    try { await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId }); localStorage.setItem(LS, JSON.stringify({ accountId, secret: key.secretKey })); return { accountId, secret: key.secretKey }; }
    catch { await new Promise(res => setTimeout(res, 2000)); }
  }
  throw new Error('faucet account did not appear on chain');
}

/** NEAR Connect on testnet with the guest wallet injected as one more choice. */
export function makeConnector(rpc) {
  const guest = guestWallet(rpc); decoratePicker();
  window.addEventListener('near-selector-ready', () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: guest })));
  const connector = new NearConnector({ network: 'testnet', footerBranding: null, cspNonce: document.querySelector('script[nonce]')?.nonce || undefined });
  window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: guest }));
  return { connector, GUEST_ID };
}

export async function currentAccount(connector) {
  try { const { accounts } = await connector.getConnectedWallet(); return accounts?.[0]?.accountId || null; } catch { return null; }
}

export function txHashOf(res) {
  return res?.transaction?.hash || res?.transaction_outcome?.id || (Array.isArray(res) ? txHashOf(res[res.length - 1]) : null);
}
