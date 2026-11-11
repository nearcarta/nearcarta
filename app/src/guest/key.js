// The guest key and the guest signer. The secret key is made here, stored here and used here: it is
// never sent to our API, never logged and never put in analytics. Only the public key leaves the page,
// and only once, to ask for the account.
//
// The signer keeps the module API the play bundle already uses (`current`, `ensureSession`, `move`,
// `view`, `account`) so `app/src/market/live-play.js` works unchanged: a guest and an email wallet sign
// the same way from the rest of the city's point of view.
//
// Docs: https://docs.near.org/tools/near-api (KeyPair, KeyPairSigner, Account)
//       https://docs.near.org/protocol/accounts-contracts/access-keys · https://docs.near.org/protocol/accounts-contracts/account-id
import { NET, cfg, api } from '../../../shared/net/net.js';

export const GUEST_KEY = 'nearcarta.guest.v1';
export const GUEST_VERSION = 1;

const now = () => Date.now();
const read = (store) => {
  try {
    const raw = store?.getItem(GUEST_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || v.v !== GUEST_VERSION || typeof v.secretKey !== 'string') return null;
    return v;
  } catch { return null; }
};
const write = (store, value) => {
  try { store?.setItem(GUEST_KEY, JSON.stringify(value)); return true; } catch { return false; }
};

/** What this browser remembers, without ever returning the secret. */
export function guestRecord(store = globalThis.localStorage) {
  const v = read(store);
  if (!v) return null;
  return { v: v.v, net: v.net, account: v.account || null, publicKey: v.publicKey || null, createdAt: v.createdAt || null };
}

/** True when this browser has a guest key for the network the page is on. */
export function hasGuest(store = globalThis.localStorage) {
  const v = read(store);
  return !!v && v.net === NET && !!v.secretKey;
}

/** The secret, for the download button only. Nothing else should call this. */
export function guestSecret(store = globalThis.localStorage) {
  const v = read(store);
  return v && v.net === NET ? v.secretKey : null;
}

/**
 * Make a key for this browser. Returns the public key, which is the only part that may leave the page.
 * `near-api-js` is imported lazily so a page that never presses Try free never downloads it.
 */
export async function createGuestKey({ store = globalThis.localStorage, net = NET } = {}) {
  const { KeyPair } = await import('near-api-js');
  const kp = KeyPair.fromRandom('ed25519');
  const rec = { v: GUEST_VERSION, net, account: null, secretKey: kp.toString(), publicKey: kp.getPublicKey().toString(), createdAt: now() };
  if (!write(store, rec)) throw new Error('ERR_STORAGE');
  return rec.publicKey;
}

/** Remember which account the funder made for this key. */
export function rememberAccount(account, { store = globalThis.localStorage } = {}) {
  const v = read(store);
  if (!v) return null;
  write(store, { ...v, account: String(account) });
  return String(account);
}

/** Forget the guest entirely. "Start over" makes a new key, which counts against the IP cap. */
export function forgetGuest({ store = globalThis.localStorage } = {}) {
  try { store?.removeItem(GUEST_KEY); return true; } catch { return false; }
}

/**
 * Ask the testnet service for this browser's account. Only the public key is sent.
 * Returns `{ ok, account, txs, resumed, why }`; `why` is the ERR_ code the UI explains.
 */
export async function startGuest({ store = globalThis.localStorage, net = NET, fetchF = globalThis.fetch, turnstile } = {}) {
  if (net !== 'testnet') return { ok: false, why: 'ERR_NOT_TESTNET' };
  let publicKey = read(store)?.publicKey;
  if (!publicKey || read(store)?.net !== net) publicKey = await createGuestKey({ store, net });
  let res;
  try {
    res = await fetchF(api('/api/guest/start'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(turnstile ? { public_key: publicKey, turnstile } : { public_key: publicKey }),
    });
  } catch {
    return { ok: false, why: 'ERR_OFFLINE' };
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || body?.ok === false) return { ok: false, why: body?.why || body?.error || 'ERR_START', status: res.status, body };
  rememberAccount(body.account, { store });
  return { ok: true, ...body };
}

/** The welcome crate: test USD and the market space, paid by the funder. */
export async function welcomeCrate(account, { fetchF = globalThis.fetch } = {}) {
  try {
    const res = await fetchF(api('/api/guest/welcome'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account }) });
    return await res.json();
  } catch { return { ok: false, items: [] }; }
}

/** The first failure in a transaction result, or null. */
export function failureOf(r) {
  for (const o of [r?.transaction_outcome, ...(r?.receipts_outcome || [])]) {
    const f = o?.outcome?.status?.Failure;
    if (f) return JSON.stringify(f).slice(0, 300);
  }
  return null;
}

/**
 * The guest signer. Same shape as the email-wallet signer in the play bundle, so the city does not
 * need to know which one it has.
 */
export async function guestSigner({ store = globalThis.localStorage, net = NET, rpc = cfg.rpc[0] } = {}) {
  const v = read(store);
  if (!v || v.net !== net || !v.secretKey || !v.account) return null;
  const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
  const account = new Account(v.account, new JsonRpcProvider({ url: rpc }), KeyPairSigner.fromSecretKey(v.secretKey));
  return {
    kind: 'guest',
    accountId: v.account,
    publicKey: v.publicKey,
    /** A direct view call. Free, no signing. */
    async view(contractId, method, args = {}) {
      const r = await account.provider.callFunction({ contractId, method, args, blockQuery: { finality: 'final' } });
      return r ?? null;
    },
    /** A direct transaction the guest signs and sends itself. */
    async call(contractId, method, args = {}, { deposit = 0n, gas = 100n * 10n ** 12n } = {}) {
      const r = await account.signAndSendTransaction({ receiverId: contractId, waitUntil: 'FINAL', throwOnFailure: false, actions: [A.functionCall(method, args, gas, deposit)] });
      return { hash: r?.transaction?.hash || null, failure: failureOf(r), raw: r };
    },
    /**
     * Sign a text with the guest key, hex encoded (64 bytes -> 128 hex). The board checks this against the
     * row's agent key, which is this key, so a `propose_call_as` is authorised from this browser alone.
     * Docs: https://docs.near.org/protocol/accounts-contracts/access-keys
     */
    async sign(text) {
      const { KeyPair } = await import('near-api-js');
      const sig = KeyPair.fromString(v.secretKey).sign(new TextEncoder().encode(String(text))).signature;
      return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
    },
    /** The account's balance in yoctoNEAR, or null when it cannot be read. */
    async balance() {
      try { const a = await account.provider.viewAccount({ accountId: v.account, blockQuery: { finality: 'final' } }); return String(a.amount); } catch { return null; }
    },
    /** The JSON a "Save my test key" button downloads. It says in words that it is worth nothing. */
    exportKey() {
      return { v: 1, network: 'testnet', account: v.account, public_key: v.publicKey, secret_key: v.secretKey, warning: 'A NEAR testnet key. Testnet NEAR has no value and cannot be spent on mainnet.' };
    },
  };
}

/** What the UI says for each refusal. One honest line, no jargon. */
export const WHY = {
  ERR_GUEST_IP_CAP: 'Free tries are used up for today. Practice mode still works.',
  ERR_GUEST_DAY_CAP: 'The city has made all its free accounts for today. Practice mode still works.',
  ERR_GUEST_FUNDER_LOW: 'The free testnet float has run low. Practice mode still works.',
  ERR_GUEST_OFF: 'Free play is not switched on here. Practice mode still works.',
  ERR_NOT_TESTNET: 'This page is on the real-money network, so there is no free account here.',
  ERR_NAME_TAKEN: 'That name is already in use. Press Try free again to get a new key.',
  ERR_PUBLIC_KEY: 'The key this browser made was not usable. Press Try free again.',
  ERR_TURNSTILE: 'The check did not pass. Press Try free again.',
  ERR_OFFLINE: 'The city did not answer. Check your connection, or use Practice mode.',
  ERR_START: 'The city did not make an account this time. Practice mode still works.',
};
export const whyText = (code) => WHY[code] || 'The city could not make a free account. Practice mode still works.';
