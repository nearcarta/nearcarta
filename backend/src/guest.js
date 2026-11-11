// Guest accounts: a visitor presses Try free and gets their own NEAR testnet account in seconds.
//
// The browser makes an ed25519 key pair and keeps the secret. Only the PUBLIC key is sent here.
// This module sends one transaction from the funder account:
//   CreateAccount + Transfer(GUEST_FUND_NEAR) + AddKey(public_key, FullAccess)
// The account name is derived from the public key, so a retry is idempotent: if the account already
// exists with this key the call returns it and sends nothing. A second batch mints the welcome crate
// (test USD and the market storage deposit), so the guest pays nothing to start.
//
// The guest's parent must sign a CreateAccount for a sub-account, so the funder IS the parent
// (`play.nearcarta.testnet`). Only the testnet service exposes this: on mainnet every route here
// answers 404, so a guest can never be created next to the real money.
//
// Docs: https://docs.near.org/protocol/accounts-contracts/account-id (a parent creates its sub-accounts)
//       https://docs.near.org/protocol/accounts-contracts/access-keys (FullAccess vs FunctionCall)
//       https://docs.near.org/protocol/tutorials/creating-implicit-and-named-accounts
//       https://docs.near.org/tools/near-api · https://docs.near.org/getting-started/faucet
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Account, JsonRpcProvider, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg, DEP, NET } from './config.js';
import { rpc, view, viewAccount } from './near.js';

const NEAR = 10n ** 24n;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export const nearOf = (yocto) => {
  const v = BigInt(yocto);
  const w = v / NEAR;
  const f = (v % NEAR).toString().padStart(24, '0').slice(0, 6).replace(/0+$/, '');
  return f ? `${w}.${f}` : `${w}`;
};
export const toYocto = (s) => {
  const [a, b = ''] = String(s).split('.');
  if (!/^\d+$/.test(a || '0') || !/^\d*$/.test(b)) throw new Error('ERR_AMOUNT');
  return BigInt(a || 0) * NEAR + BigInt((b + '0'.repeat(24)).slice(0, 24));
};

/** The guest's parent and the record the guest story runs against. */
export const guestCfg = () => ({
  on: NET === 'testnet',
  parent: DEP.guest?.parent || '',
  suffix: DEP.guest?.suffix || '',
  fund: toYocto(process.env.GUEST_FUND_NEAR || DEP.guest?.fund_near || '0.25'),
  tusdc: DEP.ft?.tusdc || '',
  market: DEP.market?.contract || '',
  board: DEP.board?.contract || '',
  welcomeUsdc: String(DEP.guest?.welcome?.tusdc || '100000000'),
  marketStorage: toYocto(DEP.guest?.welcome?.market_storage_near || '0.012'),
  perIpDay: Number(process.env.GUEST_PER_IP_DAY || DEP.guest?.caps?.per_ip_day || 3),
  globalDay: Number(process.env.GUEST_GLOBAL_DAY || DEP.guest?.caps?.global_day || 400),
  funderFloor: toYocto(process.env.GUEST_FUNDER_FLOOR_NEAR || DEP.guest?.caps?.funder_floor_near || '10'),
  turnstile: (process.env.GUEST_TURNSTILE_SECRET || '').trim() || null,
});

const PUBLIC_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/;

/** True when a public key parses as an ed25519 key we can put on an account. */
export function publicKeyOk(pk) {
  if (typeof pk !== 'string' || !PUBLIC_KEY.test(pk)) return false;
  const raw = pk.slice('ed25519:'.length);
  return bs58.decode(raw).length === 32;
}

/** Base32 of sha256(key), first 10 letters. A sub-account name is lowercase a-z2-7, so this is legal. */
export function guestName(publicKey) {
  const digest = createHash('sha256').update(String(publicKey)).digest();
  let out = '';
  for (let i = 0; i < 10; i++) out += BASE32[digest[i] % 32];
  return out;
}

export const guestAccount = (publicKey, parent) => `${guestName(publicKey)}.${parent}`;

/** Any field that looks like a secret is refused before it is read. The browser sends only a public key. */
export const SECRET_FIELD = /secret|private|seed|mnemonic/i;
export function refusedSecretField(body) {
  if (!body || typeof body !== 'object') return null;
  for (const k of Object.keys(body)) if (SECRET_FIELD.test(k)) return k;
  return null;
}

const funderKey = () => (process.env.GUEST_FUNDER_PRIVATE_KEY || '').trim();
const funderAccount = () => (process.env.GUEST_FUNDER_ACCOUNT || DEP.guest?.parent || '').trim();
export const hasFunder = () => !!funderKey() && !!funderAccount() && !!process.env.GUEST_FUNDER_PRIVATE_KEY;

let sender = null;
function funder() {
  if (!sender) {
    sender = new Account(funderAccount(), new JsonRpcProvider({ url: cfg.rpc }), KeyPairSigner.fromSecretKey(funderKey()));
  }
  return sender;
}

const hashOf = (r) => r?.transaction?.hash || r?.transaction_outcome?.id || null;
const failureOf = (r) => {
  for (const o of [r?.transaction_outcome, ...(r?.receipts_outcome || [])]) {
    const f = o?.outcome?.status?.Failure;
    if (f) return JSON.stringify(f).slice(0, 300);
  }
  return null;
};

/** The funder's spendable balance, so the status route can show the floor before it refuses one. */
export async function funderBalance() {
  try {
    const a = await viewAccount(funderAccount());
    return BigInt(a.amount) - BigInt(a.storage_usage) * (10n ** 19n);
  } catch { return null; }
}

/** Does this account exist AND carry this public key? Only then is a start idempotent. */
export async function accountHasKey(accountId, publicKey) {
  try {
    await viewAccount(accountId);
  } catch {
    return { exists: false, hasKey: false };
  }
  try {
    await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey });
    return { exists: true, hasKey: true };
  } catch {
    return { exists: true, hasKey: false };
  }
}

const txUrl = (h) => (h ? `${DEP.explorer || 'https://testnet.nearblocks.io'}/txns/${h}` : '');
const addrUrl = (a) => (a ? `${DEP.explorer || 'https://testnet.nearblocks.io'}/address/${a}` : '');
const refuse = (why, status = 400, extra = {}) => ({ ok: false, why, status, ...extra });

/**
 * Start (or resume) a guest. Idempotent by construction: the name is a hash of the key, so the
 * same browser asking twice gets the same account and no second transaction.
 * @param {{ public_key?: string, turnstile?: string }} body
 * @param {{ send?: Function, accountFor?: Function, balance?: Function, keyCheck?: Function, caps?: { take?: Function, global?: Function } }} deps
 */
export async function start(body = {}, deps = {}) {
  // `deps.net` lets a test pin the service's network; in production it is the process's own NEAR_NETWORK.
  const net = deps.net || NET;
  if (net !== 'testnet') return refuse('ERR_NOT_TESTNET', 404);
  const bad = refusedSecretField(body);
  if (bad) return refuse('ERR_SECRET_FIELD', 400, { field: bad });
  const cfgG = { ...guestCfg(), ...(deps.cfg || {}) };
  if (!cfgG.parent) return refuse('ERR_GUEST_OFF', 503);
  const pk = String(body.public_key || '').trim();
  if (!publicKeyOk(pk)) return refuse('ERR_PUBLIC_KEY', 400);
  const account = (deps.accountFor || guestAccount)(pk, cfgG.parent);

  const check = deps.keyCheck ? await deps.keyCheck(account, pk) : await accountHasKey(account, pk);
  if (check.exists && check.hasKey) {
    return {
      ok: true, resumed: true, account, network: 'testnet', fund: nearOf(cfgG.fund),
      txs: [], explorer: addrUrl(account),
      note: 'This browser already has a test account. Nothing was created.',
    };
  }
  if (check.exists && !check.hasKey) return refuse('ERR_NAME_TAKEN', 409);

  const balance = deps.balance ? await deps.balance() : (hasFunder() ? await funderBalance() : null);
  if (balance != null && balance < cfgG.funderFloor) return refuse('ERR_GUEST_FUNDER_LOW', 503, { floor_near: nearOf(cfgG.funderFloor) });
  if (!hasFunder() && !deps.send) return refuse('ERR_GUEST_OFF', 503);

  const caps = deps.caps || {};
  const cap = caps.take ? caps.take(account) : null;
  if (cap) return refuse(cap, 429);
  const global = caps.global ? caps.global() : null;
  if (global) return refuse(global, 503);

  const created = await createWithKey(account, pk, cfgG.fund, deps.send);
  if (created.failure) return refuse('ERR_SEND: ' + created.failure, 502, { txs: [created.tx].filter(Boolean) });
  return {
    ok: true, resumed: false, account, network: 'testnet', fund: nearOf(cfgG.fund),
    txs: [created.tx].filter(Boolean), explorer: addrUrl(account),
    tx_links: [created.tx].filter(Boolean).map(txUrl),
    note: 'Created on testnet. The key stays in this browser; nothing else was sent.',
  };
}

/** Create + fund + add the given ed25519 public key, in one transaction. */
export async function createWithKey(accountId, publicKeyRaw, fund, send) {
  const { PublicKey } = await import('near-api-js');
  const acts = [A.createAccount(), A.transfer(fund), A.addFullAccessKey(PublicKey.from(publicKeyRaw))];
  // A caller that brings its own sender (a test, or an operator dry run) never reads a key.
  let r;
  if (send) r = await send(accountId, acts);
  else r = await funder().signAndSendTransaction({ receiverId: accountId, actions: acts, waitUntil: 'FINAL', throwOnFailure: false });
  return { tx: hashOf(r), failure: failureOf(r) };
}
// One crate per guest. The route is public, so without this a caller could ask for the same crate again
// and again and spend the funder's float on storage deposits. The chain is the record: a guest that
// already holds market storage or test dollars has had its crate, and a name that does not exist gets none.
const crated = new Set();
export async function crateState(accountId, deps = {}) {
  const cfgG = { ...guestCfg(), ...(deps.cfg || {}) };
  const exists = deps.exists ? await deps.exists(accountId) : await viewAccount(accountId).then(() => true, () => false);
  if (!exists) return { exists: false };
  const viewF = deps.view || view;
  const usdc = cfgG.tusdc ? BigInt(await viewF(cfgG.tusdc, 'ft_balance_of', { account_id: accountId }).catch(() => '0') || '0') : 0n;
  const st = cfgG.market ? await viewF(cfgG.market, 'storage_balance_of', { account_id: accountId }).catch(() => null) : null;
  const stored = BigInt((st && typeof st === 'object' ? st.total : st) || '0');
  return { exists: true, hasUsdc: usdc > 0n, hasStorage: stored > 0n };
}

export async function welcome(accountId, deps = {}) {
  if ((deps.net || NET) !== 'testnet') return refuse('ERR_NOT_TESTNET', 404);
  const cfgG = { ...guestCfg(), ...(deps.cfg || {}) };
  if (crated.has(accountId)) return { ok: true, already: true, account: accountId, items: [] };
  const state = await crateState(accountId, deps);
  if (!state.exists) return refuse('ERR_NO_ACCOUNT', 404);
  if (state.hasUsdc && state.hasStorage) { crated.add(accountId); return { ok: true, already: true, account: accountId, items: [] }; }
  crated.add(accountId);
  const call = async (receiverId, acts) => (deps.send
    ? deps.send(receiverId, acts)
    : funder().signAndSendTransaction({ receiverId, actions: acts, waitUntil: 'FINAL', throwOnFailure: false }));
  const out = [];
  if (cfgG.tusdc && !state.hasUsdc) {
    const r = await call(cfgG.tusdc, [A.functionCall('mint', { account_id: accountId, amount: cfgG.welcomeUsdc }, 30n * 10n ** 12n, 0n)]);
    out.push({ item: 'tusdc', amount: cfgG.welcomeUsdc, symbol: 'tUSDC', tx: hashOf(r), failure: failureOf(r), link: txUrl(hashOf(r)) });
  }
  if (cfgG.market && !state.hasStorage) {
    const r = await call(cfgG.market, [A.functionCall('storage_deposit', { account_id: accountId }, 20n * 10n ** 12n, cfgG.marketStorage)]);
    out.push({ item: 'market_space', tx: hashOf(r), failure: failureOf(r), link: txUrl(hashOf(r)) });
  }
  return { ok: out.every((x) => !x.failure), account: accountId, items: out };
}

/** GET status: the caps and the funder float, so an operator can see the floor before guests hit it. */
export async function status() {
  const cfgG = guestCfg();
  const bal = hasFunder() ? await funderBalance() : null;
  return {
    ok: true,
    network: NET,
    on: NET === 'testnet' && !!cfgG.parent && hasFunder(),
    parent: cfgG.parent || null,
    caps: { per_ip_day: cfgG.perIpDay, global_day: cfgG.globalDay, funder_floor_near: nearOf(cfgG.funderFloor), fund_near: nearOf(cfgG.fund) },
    funder_balance_near: bal == null ? null : nearOf(bal),
    funder_below_floor: bal == null ? null : bal < cfgG.funderFloor,
    turnstile: !!cfgG.turnstile,
  };
}

/** Cloudflare Turnstile check, only when a secret is configured. Off by default so judges see no friction. */
export async function turnstileOk(token, secret = guestCfg().turnstile, fetchF = fetch) {
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: String(token) });
    const r = await fetchF('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return j?.success === true;
  } catch {
    return false;
  }
}
