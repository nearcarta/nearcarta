// NEP-366 relayer for Market Day: players sign moves with their function-call key, the relayer pays gas.
// Every move is checked by shared/relay/policy.js before it is sent: only zero-deposit market moves, or a
// board row call aimed at the market, from a function-call key on that receiver, with a fresh nonce.
// It spends from a small float (RELAYER_ACCOUNT) and stops at a daily NEAR budget, so a flood of moves
// costs at most that budget. The relayer key comes only from the server env and is never logged.
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import { deserialize } from 'borsh';
import bs58 from 'bs58';
import { Account, JsonRpcProvider, KeyPairSigner, SCHEMA, encodeDelegateAction } from 'near-api-js';
import { cfg } from './config.js';
import { rpc, view, viewAccount } from './near.js';
import { policy, checkDelegate, checkKey, caps as makeCaps } from '../../shared/relay/policy.js';

const NEAR = 10n ** 24n;
const yoctoToNear = (y) => { const v = BigInt(y); const w = v / NEAR, f = (v % NEAR).toString().padStart(24, '0').slice(0, 6).replace(/0+$/, ''); return f ? `${w}.${f}` : `${w}`; };
const toYocto = (s) => { const [a, b = ''] = String(s).split('.'); return BigInt(a || 0) * NEAR + BigInt((b + '0'.repeat(24)).slice(0, 24)); };
export const conf = () => ({
  account: process.env.RELAYER_ACCOUNT || '',
  market: process.env.MARKET_ACCOUNT || 'arena.nearcarta.near',
  board: process.env.BOARD_ACCOUNT || 'board.nearcarta.near',
  dailyNear: toYocto(process.env.RELAY_DAILY_NEAR || '0.05'),
  sessionFund: toYocto(process.env.SESSION_FUND_NEAR || '0.003'),
  // A whole Market Day (bag, purse, a stall, a share) stores about 0.011 NEAR of data on the market.
  sessionStorage: toYocto(process.env.SESSION_STORAGE_NEAR || '0.012'),
  // Below this, a returning visitor's market storage is topped back up to sessionStorage (same caps).
  storageLow: toYocto(process.env.SESSION_STORAGE_LOW_NEAR || '0.003'),
  // Sponsored gas one visitor may burn per UTC day.
  visitorNear: toYocto(process.env.RELAY_VISITOR_NEAR || '0.003'),
});
const hasKey = () => !!(process.env.RELAYER_PRIVATE_KEY || '').trim() && !!conf().account;

const day = () => new Date().toISOString().slice(0, 10);
export const ledger = { day: day(), spent: 0n, relays: 0, sessions: 0, refused: {}, by: new Map() };
function roll() { if (ledger.day !== day()) Object.assign(ledger, { day: day(), spent: 0n, relays: 0, sessions: 0, refused: {}, by: new Map() }); }
export const counters = makeCaps({ perSender: Number(process.env.RELAY_PER_SENDER || 40), perDay: Number(process.env.RELAY_PER_DAY || 4000), sessionsPerDay: Number(process.env.SESSIONS_PER_DAY || 4) });
export function status() { roll(); const c = conf(); return { on: hasKey(), relayer: c.account || null, market: c.market, board: c.board, day: ledger.day, spent_near: yoctoToNear(ledger.spent.toString()), budget_near: yoctoToNear(c.dailyNear.toString()), visitor_near: yoctoToNear(c.visitorNear.toString()), relays: ledger.relays, sessions: ledger.sessions, refused: ledger.refused, caps: counters.status() }; }
const refuse = (why, status = 400) => { roll(); ledger.refused[why] = (ledger.refused[why] || 0) + 1; return { ok: false, why, status }; };

export function decode(b64) {
  try { const bytes = Buffer.from(String(b64 || ''), 'base64'); if (bytes.length < 100 || bytes.length > 4096) return null; return deserialize(SCHEMA.SignedDelegate, bytes); } catch { return null; }
}
/** NEP-366: the signature is over sha256(NEP-461 prefix + borsh(DelegateAction)). */
export function verifySig(sd) {
  try {
    const msg = createHash('sha256').update(encodeDelegateAction(sd.delegateAction)).digest();
    return nacl.sign.detached.verify(msg, Uint8Array.from(sd.signature.ed25519Signature.data), Uint8Array.from(sd.delegateAction.publicKey.ed25519Key.data));
  } catch { return false; }
}
const b58pk = (pk) => 'ed25519:' + bs58.encode(Uint8Array.from(pk.ed25519Key.data));

let acct = null;
function relayer() {
  if (!acct) acct = new Account(conf().account, new JsonRpcProvider({ url: cfg.rpc }), KeyPairSigner.fromSecretKey(process.env.RELAYER_PRIVATE_KEY.trim()));
  return acct;
}
const burnt = (r) => { let y = BigInt(r?.transaction_outcome?.outcome?.tokens_burnt || 0); for (const o of r?.receipts_outcome || []) y += BigInt(o.outcome?.tokens_burnt || 0); return y; };
const hashOf = (r) => r?.transaction_outcome?.id || r?.transaction?.hash || null;
const failure = (r) => { for (const o of [r?.transaction_outcome, ...(r?.receipts_outcome || [])]) { const f = o?.outcome?.status?.Failure; if (f) return JSON.stringify(f).slice(0, 300); } return null; };

/** Relay one move. deps are injectable for tests. */
export async function relay(b64, { send = (sd) => relayer().relayMetaTransaction(sd), keyOf, heightOf, now = Date.now } = {}) {
  roll(); const c = conf();
  if (!hasKey() && !send.__test) return refuse('ERR_RELAYER_OFF', 503);
  const sd = decode(b64); if (!sd) return refuse('ERR_DECODE');
  const d = sd.delegateAction;
  const height = heightOf ? await heightOf() : (await rpc('block', { finality: 'final' })).header.height;
  const p = checkDelegate(sd, policy(c), { height }); if (!p.ok) return refuse(p.why);
  if (!verifySig(sd)) return refuse('ERR_SIGNATURE');
  const key = keyOf ? await keyOf(d.senderId, d.publicKey) : await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: d.senderId, public_key: b58pk(d.publicKey) }).catch(() => null);
  const k = checkKey(key, d, Buffer.from(Uint8Array.from(d.publicKey.ed25519Key.data)).toString('hex')); if (!k.ok) return refuse(k.why);
  // Worst case for this move: all attached gas burnt at 0.1 NEAR per 1000 Tgas (100M yocto per gas).
  const worst = p.gas * 100_000_000n;
  if (ledger.spent + worst > c.dailyNear) return refuse('ERR_DAILY_BUDGET', 429);
  if ((ledger.by.get(d.senderId) || 0n) >= c.visitorNear) return refuse('ERR_VISITOR_GAS_CAP', 429);
  const cap = counters.take(d.senderId); if (cap) return refuse(cap, 429);
  let r; try { r = await send(sd); } catch (e) { return refuse('ERR_SEND: ' + String(e.message || e).slice(0, 160), 502); }
  const y = burnt(r); ledger.spent += y; ledger.relays++;
  ledger.by.set(d.senderId, (ledger.by.get(d.senderId) || 0n) + y);
  const f = failure(r);
  return { ok: !f, hash: hashOf(r), sender: d.senderId, receiver: d.receiverId, methods: d.actions.map((a) => a.functionCall.methodName), burnt_near: yoctoToNear(y.toString()), failure: f, explorer: hashOf(r) ? `https://nearblocks.io/txns/${hashOf(r)}` : null };
}

/**
 * A capped sponsored first session: once per account, fund a brand-new implicit account just enough to
 * exist and hold one session key, and give it a small market storage deposit. Counted against the
 * daily session cap and the daily budget.
 */
export async function session(accountId, { acc = () => relayer(), viewAcc = viewAccount, storageOf } = {}) {
  roll(); const c = conf();
  if (!hasKey() && !storageOf) return refuse('ERR_RELAYER_OFF', 503);
  const id = String(accountId || '').trim().toLowerCase();
  if (!/^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id)) return refuse('ERR_ACCOUNT');
  const implicit = /^[0-9a-f]{64}$/.test(id);
  let exists = true; try { await viewAcc(id); } catch { exists = false; }
  if (!exists && !implicit) return refuse('ERR_NO_ACCOUNT');
  const stored = storageOf ? await storageOf(id) : BigInt(await view(c.market, 'storage_balance_of', { account_id: id }).catch(() => '0'));
  const needFund = !exists, needStorage = BigInt(stored) < c.storageLow;
  if (!needFund && !needStorage) return { ok: true, already: true, account: id, txs: [] };
  const add = needStorage ? c.sessionStorage - BigInt(stored) : 0n;
  const cost = (needFund ? c.sessionFund : 0n) + add + 2n * 10n ** 21n;
  if (ledger.spent + cost > c.dailyNear * 2n) return refuse('ERR_DAILY_BUDGET', 429);
  const cap = counters.session(); if (cap) return refuse(cap, 429);
  const a = acc(); const txs = [];
  try {
    if (needFund) { const r = await a.transfer({ receiverId: id, amount: c.sessionFund }); txs.push(hashOf(r)); ledger.spent += c.sessionFund + burnt(r); }
    if (needStorage) {
      const r = await a.callFunction({ contractId: c.market, methodName: 'storage_deposit', args: { account_id: id }, deposit: add, gas: 10n * 10n ** 12n });
      txs.push(hashOf(r) || null); ledger.spent += add;
    }
  } catch (e) { return { ...refuse('ERR_SEND: ' + String(e.message || e).slice(0, 160), 502), txs }; }
  ledger.sessions++;
  return { ok: true, account: id, funded: needFund ? yoctoToNear(c.sessionFund.toString()) : '0', storage: needStorage ? yoctoToNear(add.toString()) : '0', txs };
}

export function register(app, { limiter, globalCap }) {
  const cap = globalCap('relay', Number(process.env.CAP_RELAY_PER_MIN || 120));
  app.get('/api/relay/status', limiter(30), (c) => c.json(status()));
  app.post('/api/relay', limiter(30), cap, async (c) => {
    let b; try { b = await c.req.json(); } catch { b = null; }
    const r = await relay(b?.signed_delegate);
    return c.json(r, r.ok === false && r.status ? r.status : 200);
  });
  app.post('/api/relay/session', limiter(3), globalCap('relay-session', 6), async (c) => {
    let b; try { b = await c.req.json(); } catch { b = null; }
    const r = await session(b?.account_id);
    return c.json(r, r.ok === false && r.status ? r.status : 200);
  });
}
