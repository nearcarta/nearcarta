// Mist Bank send queue: a visitor's own charter approves a tiny private payout of testnet ZEC to
// the visitor's own Orchard-only address. This server only VERIFIES and QUEUES. It never holds a
// Zcash key, never knows the amount and never sees a salt or a viewing key.
//  1. POST /api/mistbank/send/prepare {ua}: checks the address, returns the memo the charter must sign.
//  2. The visitor's agent proposes on its charter: shop "mistbank", memo = that memo ("Ask the agent
//     to pay" with this memo works). The memo is a hash of the address, so one approval fits one address.
//  3. POST /api/mistbank/send {ua, charter, approval_tx}: the approval is read back from chain
//     (signed by the charter itself, decision "allowed", memo hash matches, at most 24 h old, charter
//     runs a published oath build and has no full-access key). Then the request is queued.
//  4. The box worker (backend/scripts/mist-worker.js) pulls the queue with a token that exists only
//     in the Render env and on the box, re-checks the approval itself, waits a random delay, sends,
//     and reports back only the Zcash txid and the commitment sha256("mistbank:v1:<amount>:<salt>").
// Render's disk is not kept across deploys, so the worker re-sends its last 26 h of records on every
// sync; status and the replay checks survive a restart that way. The address is dropped from memory
// as soon as the worker has the request.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DEP } from './config.js';
import { zcashRecipient } from './zcash.js';
import { rpc, txStatus, txResult, eventsFromOutcome, explorerTx, viewAccount, accessKeys } from './near.js';

const err = (status, message) => Object.assign(new Error(message), { status });
const H = 3600e3, DAY = 24 * H;
export const SHOP = 'mistbank';
export const MEMO_PREFIX = 'mbq1:';
export const LIMITS = {
  per_charter_per_day: 1,
  per_ip_per_hour: 3,
  global_per_day: Number(process.env.MIST_QUEUE_DAILY_MAX || 10),
  approval_max_age_hours: 24,
  delay: 'random, 15 to 45 minutes after the request is queued',
  amount: 'one small fixed testnet amount, set on the worker only; never in any response',
};
const KEEP_MS = 26 * H;
const WORKER_STALE_MS = 5 * 60e3;

export const queueMemo = ua => MEMO_PREFIX + createHash('sha256').update(`nearcarta:mistbank-queue:v1:${ua}`).digest('base64url');
const sha256hex = s => createHash('sha256').update(s).digest('hex');

// The published oath builds a charter may run (R11 guardhouse/house, R15 factory pin, legacy factory, R16).
export const OATH_HASHES = [...new Set([DEP.guardhouse?.code_hash, DEP.house?.code_hash, DEP.vault?.code_hash,
  ...(DEP.vault?.legacy || []).map(l => l.code_hash), DEP.oath_r16?.code_hash].filter(Boolean))];

export function checkUa(ua) {
  if (typeof ua !== 'string' || ua.length > 1000 || !/^utest1[0-9a-z]+$/.test(ua)) throw err(400, 'ua must be a Zcash testnet unified address (utest1...)');
  let r;
  try { r = zcashRecipient(ua); } catch (e) { throw err(400, `ua does not decode: ${e.message}`); }
  if (!r.orchard_only) throw err(400, `ua must carry exactly one receiver, Orchard (${r.receivers.join(' + ')})`);
  return r;
}
const ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*\.testnet$/;
const TXHASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

// Reads the approval back from chain. Used by this server AND independently by the box worker.
const CHAIN = { rpc, txStatus, viewAccount, accessKeys };
export async function verifyApproval({ ua, charter, approval_tx }, { now = Date.now(), maxAgeMs = DAY, chain = CHAIN } = {}) {
  if (!ACCOUNT.test(String(charter))) throw err(400, 'charter must be a testnet account id');
  if (!TXHASH.test(String(approval_tx))) throw err(400, 'approval_tx must be a NEAR tx hash');
  const memo = queueMemo(ua);
  const [acc, keys] = await Promise.all([chain.viewAccount(charter), chain.accessKeys(charter)]);
  if (!OATH_HASHES.includes(acc.code_hash)) throw err(422, 'charter does not run a published oath build');
  const fak = (keys.keys || []).filter(k => k.access_key.permission === 'FullAccess').length;
  if (fak) throw err(422, 'charter has a full-access key, so its rules can be bypassed');
  let tx;
  try { tx = await chain.txStatus(approval_tx, charter); } catch { throw err(422, 'approval tx not found for this charter'); }
  const t = tx.transaction || {};
  if (t.signer_id !== charter || t.receiver_id !== charter) throw err(422, 'approval tx was not signed by the charter on itself');
  const fc = (t.actions || []).map(a => a.FunctionCall).find(f => f?.method_name === 'propose');
  let p = null;
  try { p = JSON.parse(Buffer.from(fc.args, 'base64').toString('utf8')).p; } catch { /* checked below */ }
  if (!p || p.shop !== SHOP || p.memo !== memo) throw err(422, `approval must be propose with shop "${SHOP}" and memo from /api/mistbank/send/prepare for this ua`);
  const r = txResult(tx);
  const ev = eventsFromOutcome(tx).events.find(e => e.standard === 'oath' && e.event === 'action' && e.executor === charter)?.data?.[0];
  const decision = ev?.decision;
  if (!r.ok || decision !== 'allowed' || !ev || ev.agent !== charter || ev.shop !== SHOP || ev.memo_hash !== sha256hex(memo)) throw err(422, `charter did not allow it (decision ${decision ?? 'none'})`);
  const block = await chain.rpc('block', { block_id: tx.transaction_outcome.block_hash });
  const at = Math.floor(Number(BigInt(block.header.timestamp) / 1000000n));
  if (now - at > maxAgeMs) throw err(422, 'approval is older than 24 h');
  return { charter, approval_tx, approved_at: new Date(at).toISOString(), clause_id: ev.clause_id, action_id: ev.action_id ?? null, url: explorerTx(approval_tx) };
}

// In-memory queue (rebuilt from worker syncs after a restart).
const recs = new Map(); // id -> record
let workerSeen = 0;
export const _reset = () => { recs.clear(); workerSeen = 0; };
const recent = (now) => [...recs.values()].filter(r => now - Date.parse(r.queued_at) < KEEP_MS);
const prune = (now) => { for (const [id, r] of recs) if (now - Date.parse(r.queued_at) >= KEEP_MS) recs.delete(id); };

export function info(now = Date.now()) {
  return { shop: SHOP, network: { near: 'testnet', zcash: 'testnet' }, open: workerOnline(now), worker_seen: workerSeen ? new Date(workerSeen).toISOString() : null,
    limits: LIMITS, steps: [
      'POST /api/mistbank/send/prepare {"ua":"utest1..."} -> {memo}',
      'your agent proposes on your charter: shop "mistbank", memo = that memo, any receiver and amount your rules allow',
      'POST /api/mistbank/send {"ua","charter","approval_tx"} -> 202 {id, status_url}',
      'GET /api/mistbank/send/<id> -> queued | waiting | sent (zcash txid + commitment) | failed'],
    never_returned: ['amount', 'salt', 'viewing key', 'your address after it is queued'] };
}
export const workerOnline = (now = Date.now()) => now - workerSeen < WORKER_STALE_MS;

export function prepare(ua) {
  checkUa(ua);
  return { memo: queueMemo(ua), shop: SHOP,
    propose: 'your agent key sends one `propose` to your own charter with shop "mistbank" and this memo, under any clause that allows it; once the charter allows it, POST /api/mistbank/send with that tx hash',
    why: 'the memo is a hash of your address, so this approval works for this address only' };
}

export async function enqueue(body, { now = Date.now(), verify = verifyApproval } = {}) {
  const { ua, charter, approval_tx } = body || {};
  checkUa(ua);
  if (!workerOnline(now)) throw err(503, 'the send desk is closed right now (worker offline); nothing was queued');
  prune(now);
  const rs = recent(now);
  if (rs.some(r => r.approval_tx === approval_tx)) throw err(409, 'this approval tx was already used');
  if (rs.filter(r => r.charter === charter && r.state !== 'failed').length >= LIMITS.per_charter_per_day) throw err(429, 'one send per charter per 24 h');
  if (rs.filter(r => r.state !== 'failed').length >= LIMITS.global_per_day) throw err(429, 'daily limit for the whole desk reached; try tomorrow');
  const a = await verify({ ua, charter, approval_tx }, { now });
  const id = randomBytes(16).toString('hex');
  recs.set(id, { id, ua, charter, approval_tx, approved_at: a.approved_at, queued_at: new Date(now).toISOString(), state: 'queued' });
  return { id, state: 'queued', status_url: `/api/mistbank/send/${id}`, approval: { tx: approval_tx, url: a.url, clause_id: a.clause_id }, limits: { delay: LIMITS.delay } };
}

export function status(id, now = Date.now()) {
  if (!/^[0-9a-f]{32}$/.test(String(id))) throw err(400, 'bad id');
  const r = recs.get(id);
  if (!r) throw err(404, 'unknown id (records are kept 24 h)');
  return publicView(r, now);
}
// Stale-record rule: a request still queued, waiting or sending 3 h after it was queued (the delay is at
// most 45 min) shows as expired; stuck_state keeps the last state the worker reported. A later worker sync
// that reports sent or failed replaces it.
export const STUCK_MS = 3 * 3600e3;
export function shownState(r, now = Date.now()) {
  const open = r.state === 'queued' || r.state === 'waiting' || r.state === 'sending';
  return open && now - Date.parse(r.queued_at) > STUCK_MS ? { state: 'expired', stuck_state: r.state, reason: 'no worker result 3 h after queueing; nothing was sent from this request as far as the desk knows' } : { state: r.state };
}
const publicView = (r, now = Date.now()) => ({ id: r.id, ...shownState(r, now), charter: r.charter, approval: { tx: r.approval_tx, url: explorerTx(r.approval_tx) }, queued_at: r.queued_at,
  ...(r.state === 'sent' ? { sent_at: r.sent_at, zcash: { txid: r.txid, explorer: `https://testnet.cipherscan.app/tx/${r.txid}` },
    commitment: { scheme: 'sha256("mistbank:v1:<amount>:<salt>")', value: r.commitment },
    check: 'the amount and salt sit in the encrypted memo, readable only by the address owner' } : {}),
  ...(r.state === 'failed' ? { error: r.error } : {}) });

// Worker side. Token from the Render env only (never Vercel, never the repo).
export function workerAuth(header, token = process.env.MIST_WORKER_TOKEN) {
  if (!token || token.length < 32) return false;
  const got = String(header || '').replace(/^Bearer /, '');
  const a = createHash('sha256').update(got).digest(), b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b) && got === token;
}
const STATES = new Set(['waiting', 'sending', 'sent', 'failed']);
const ERRORS = /^[a-z_]{3,40}$/;
// The worker reports what it holds; only whitelisted fields are kept, so no amount or salt can land here.
export function sync(records, { now = Date.now() } = {}) {
  if (!Array.isArray(records) || records.length > 200) throw err(400, 'records must be an array (max 200)');
  workerSeen = now;
  for (const x of records) {
    if (!/^[0-9a-f]{32}$/.test(String(x?.id)) || !STATES.has(x.state) || !ACCOUNT.test(String(x.charter)) || !TXHASH.test(String(x.approval_tx))) continue;
    if (!Number.isFinite(Date.parse(x.queued_at)) || now - Date.parse(x.queued_at) >= KEEP_MS) continue;
    const r = recs.get(x.id) || { id: x.id, charter: x.charter, approval_tx: x.approval_tx, queued_at: new Date(Date.parse(x.queued_at)).toISOString() };
    delete r.ua; // the worker has it now
    r.state = x.state;
    if (x.state === 'sent' && /^[0-9a-f]{64}$/.test(String(x.txid)) && /^[0-9a-f]{64}$/.test(String(x.commitment))) {
      r.txid = x.txid; r.commitment = x.commitment; r.sent_at = Number.isFinite(Date.parse(x.sent_at)) ? new Date(Date.parse(x.sent_at)).toISOString() : null;
    } else if (x.state === 'sent') r.state = 'sending';
    if (x.state === 'failed') r.error = ERRORS.test(String(x.error)) ? x.error : 'failed';
    recs.set(x.id, r);
  }
  prune(now);
  return { pending: [...recs.values()].filter(r => r.state === 'queued' && r.ua).map(r => ({ id: r.id, ua: r.ua, charter: r.charter, approval_tx: r.approval_tx, queued_at: r.queued_at })) };
}
