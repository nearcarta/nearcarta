// Charters and Vault Arena. Charters come from the factory on chain; every arena result is a
// final testnet tx, and the leaderboard is rebuilt from chain (factory list + each charter's
// propose txs, each one re-verified through RPC).
//
// Scoring never trusts the memo. The memo only says which attack or task a tx claims to be; the
// row counts only if the contract's own `action` event shows the planned payee and amount for that
// attack or task under the clause in force at that block, and the expected decision:
//   attack -> denied, with the reason the attack targets;   task -> allowed and settled ok.
//
// Exception to "no route can sign": POST /api/vault/attack, /api/vault/task and /api/vault/ask sign `propose` on
// the SHARED arena charter with ARENA_AGENT_KEY. That key is a function-call key that can only call
// `propose` on those charters, with no gas allowance (R18: a capped key locks out for good once its gas runs out); the charter's clause (allowlist, small caps,
// daily budget) bounds what an allowed step can move. The runner signs at 30 Tgas and stops at a
// daily tx cap. The key is read lazily and never logged or returned. Rows it signs are labelled
// server_signed.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { indexPost } from './txindex.js';
import { createHash } from 'node:crypto';
import { DEP, cfg } from './config.js';
import { rpc, view, viewAccount, accessKeys, txStatus, eventsFromOutcome, explorerTx } from './near.js';
import { ATTACKS, ATTACK_IDS, MEMO_RE, acceptedReasons, matchesPlan, pickClause, plan } from '../../shared/vault/attacks.js';
import { TASKS, TASK_IDS, TASK_MEMO_RE, matchesTask, planTask } from '../../shared/vault/tasks.js';
import { keyFrom, sendPropose, rpcClient, viewFn, PROPOSE_TGAS } from '../../shared/vault/tx.js';
import { runSteps, runTask, runAsk } from '../../shared/vault/run.js';
import { receipt as buildReceipt } from '../../shared/vault/receipt.js';
import { edgeCache } from './http-guard.js';
import { ASK_MEMO_RE, parseAsk } from '../../shared/vault/ask.js';
import * as agent from './agent.js';
import publicCharters from '../../shared/vault/public-charters.json' with { type: 'json' };

export const V = DEP.vault || null;
const ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const isAccount = a => typeof a === 'string' && ACCOUNT_RE.test(a);
const ARCHIVAL = process.env.ARCHIVAL_RPC || 'https://archival-rpc.testnet.fastnear.com';

/** Factories whose charters count: the live one first, then earlier releases (kept for history). */
const ARENAS = new Set(V ? [V.arena.charter, ...(V.arena.pool || []), ...(V.arena_history ? [V.arena_history.charter, ...(V.arena_history.pool || [])] : []), ...(V.legacy || []).map(l => l.arena?.charter).filter(Boolean)] : []);
export const isShared = c => ARENAS.has(c);
export const FACTORIES = V ? [{ factory: V.factory, code_hash: V.code_hash }, ...(V.runner_factory ? [{ factory: V.runner_factory.factory, code_hash: V.runner_factory.code_hash }] : []), ...(V.legacy || []).map(l => ({ factory: l.factory, code_hash: l.code_hash }))] : [];

export function config() {
  if (!V) throw bad('vault not deployed on this network', 503);
  return { network: DEP.network, factory: V.factory, code_hash: V.code_hash, factory_sha256: V.factory_sha256,
    min_deposit: V.min_deposit, policy_delay: V.policy_delay || null,
    arena: { charter: V.arena.charter, merchants: V.arena.merchants, owner: V.arena.owner },
    attacks: ATTACKS, tasks: TASKS, explorer: DEP.explorer, rpc: cfg.rpc, rpc_fallbacks: cfg.rpcFallbacks.filter(u => u !== cfg.rpc), proof_txs: V.proof_txs, legacy: V.legacy || [],
    attack_enabled: !!agentSecret(), runner: runnerLimits() };
}

// ---------- small LRU (refresh on read, evict the oldest) ----------
export class Lru {
  constructor(max) { this.max = max; this.m = new Map(); }
  get size() { return this.m.size; }
  has(k) { return this.m.has(k); }
  get(k) { if (!this.m.has(k)) return undefined; const v = this.m.get(k); this.m.delete(k); this.m.set(k, v); return v; }
  set(k, v) { this.m.delete(k); this.m.set(k, v); while (this.m.size > this.max) this.m.delete(this.m.keys().next().value); return this; }
  delete(k) { return this.m.delete(k); }
  clear() { this.m.clear(); }
  values() { return this.m.values(); }
  entries() { return this.m.entries(); }
}

// ---------- charter facts (cached briefly; all from chain) ----------
const cache = new Lru(5000);
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ms) return hit.v;
  const v = await fn(); cache.set(key, { t: Date.now(), v }); return v;
}
export const _clearCache = () => cache.clear();

// fresh=1 runs right after create_charter, when public RPCs often rate-limit or lag: wait and retry
// a couple of times before giving up (the API then answers 503 + Retry-After, never a bare 500).
export async function charterFacts(id, opts = {}) {
  for (let i = 0; ; i++) {
    try { return await charterFactsOnce(id, opts); }
    catch (e) {
      if (!opts.fresh || i >= 2 || e.status || !/http (429|5\d\d)\b|timeout|aborted/i.test(String(e.message))) throw e;
      await new Promise(r => setTimeout(r, opts.retryMs ?? 800 * (i + 1)));
    }
  }
}
async function charterFactsOnce(id, { fresh = false } = {}) {
  if (!V) throw bad('vault not deployed', 503);
  if (!isAccount(id)) throw bad('bad account id');
  if (fresh) cache.delete('facts:' + id);
  // fresh=1 follows a tx the page just sent: skip the short RPC cache for the charter's own state.
  const v = fresh ? freshView : view;
  const f = await cached('facts:' + id, 15_000, async () => {
    let reg = null, home = FACTORIES[0];
    for (const fa of FACTORIES) {
      if (!id.endsWith('.' + fa.factory)) continue;
      reg = await view(fa.factory, 'get_charter', { account_id: id }); home = fa; break;
    }
    let acct = null;
    try { acct = await viewAccount(id); } catch { /* missing account */ }
    if (!acct) return { charter: id, exists: false, registered: !!reg };
    const keys = (await accessKeys(id)).keys || [];
    const full = keys.filter(k => k.access_key.permission === 'FullAccess').length;
    const agentKeys = keys.filter(k => k.access_key.permission?.FunctionCall).map(k => ({ public_key: k.public_key,
      methods: k.access_key.permission.FunctionCall.method_names, receiver: k.access_key.permission.FunctionCall.receiver_id,
      allowance: k.access_key.permission.FunctionCall.allowance }));
    // runs_r14 (name kept for clients): runs the audited oath release its factory pins.
    const audited = acct.global_contract_hash === home.code_hash;
    let state = null, clauses = null, pendingChanges = null;
    let pending = false; // RPC nodes can lag right after create_charter: the account shows before its state
    if (audited) {
      try { state = await v(id, 'get_state'); clauses = await v(id, 'get_clauses'); pendingChanges = await v(id, 'get_pending'); } catch { pending = true; }
    }
    return { charter: id, exists: true, registered: !!reg, factory: home.factory, legacy: home.factory !== V.factory,
      owner: reg?.owner ?? state?.owner ?? null, created_at: reg?.created_at ?? null,
      policy_delay_ns: state?.policy_delay_ns ?? reg?.policy_delay_ns ?? null, dao: state?.dao ?? reg?.dao ?? null, setup_open: state?.setup_open ?? null,
      code_hash: acct.global_contract_hash || acct.code_hash, runs_r14: audited, full_access_keys: full, agent_keys: agentKeys,
      balance: acct.amount, state, clauses, pending_changes: pendingChanges, verified: !!reg && audited && full === 0, ...(pending ? { pending: true } : {}) };
  });
  if (!f.exists || f.pending) cache.delete('facts:' + id); // never cache a half-visible charter
  return f;
}

// Optimistic finality is never cached in near.js but keeps its retries and RPC fallbacks (429s on shared hosts).
async function freshView(accountId, method, args = {}) {
  const res = await rpc('query', { request_type: 'call_function', finality: 'optimistic', account_id: accountId, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  if (res.error) throw new Error(`view ${accountId}.${method}: ${res.error}`);
  const txt = Buffer.from(res.result).toString('utf8');
  return txt ? JSON.parse(txt) : null;
}

// True when `id` is a charter a vault factory (current or legacy) created: suffix check first, then one cached
// registry read (get_charter), so random ids under the factory cost a single view, never the full charterFacts.
export async function isFactoryCharter(id, v = view) {
  if (!isAccount(id)) return false;
  const fa = FACTORIES.find(f => f.factory && id.endsWith('.' + f.factory));
  if (!fa) return false;
  try { return await cached('reg:' + id, 60_000, async () => !!(await v(fa.factory, 'get_charter', { account_id: id }))); } catch { return false; }
}
export async function usage(id, clauseId, v = view) { return v(id, 'get_usage', { clause_id: clauseId }); }

export async function listCharters(from = 0, limit = 50, factory = V?.factory) {
  if (!V) throw bad('vault not deployed', 503);
  const f = Math.max(0, Number(from) || 0), l = Math.min(100, Math.max(1, Number(limit) || 50));
  return cached(`list:${factory}:${f}:${l}`, 10_000, async () => {
    const [config, rows] = await Promise.all([view(factory, 'get_config'), view(factory, 'list', { from_index: f, limit: l })]);
    return { factory, count: config.count, code_hash: config.code_hash,
      charters: rows.map(([charter, c]) => ({ charter, owner: c.owner, created_at: c.created_at, index: c.index,
        policy_delay_ns: c.policy_delay_ns ?? null, dao: c.dao ?? null, shared: isShared(charter) })) };
  });
}

// ---------- the shared arena runner (30 Tgas, daily tx cap) ----------
function agentSecret() { return (process.env.ARENA_AGENT_KEY || '').trim() || null; }
/** Shared demo charters (same clause, same agent key): the original one first, then the pool. */
export const sharedCharters = () => V ? [V.arena.charter, ...(V.arena.pool || [])] : [];
// Retired shared arena charters (R16 shared, R17 pool, legacy): no live agent key, kept so their history still shows.
export const historyCharters = () => V ? [...new Set([...(V.arena_history ? [V.arena_history.charter, ...(V.arena_history.pool || [])] : []),
  ...(V.legacy || []).map(l => l.arena?.charter)].filter(c => c && !sharedCharters().includes(c)))] : [];
/**
 * The shared charter with the most room left today on its 'pay' clause (payments left, then budget left).
 * Every candidate carries the identical clause, so refusals do not change; only an exhausted day stops being
 * shared by every visitor. A charter whose usage cannot be read is skipped; if none can be read, the first.
 */
export async function pickShared(viewF = view, list = sharedCharters(), cache = cached) {
  // Sequential and cheap: the clause is the same on every charter and rarely changes (cached 10 min); usage is
  // read one charter at a time and the first one with its whole day left wins, so most runs cost one or two views.
  const rows = [];
  for (const c of list) {
    try {
      const cl = (await cache('pool-clause:' + c, 600_000, () => viewF(c, 'get_clauses')))?.pay;
      if (!cl) continue;
      const u = await viewF(c, 'get_usage', { clause_id: 'pay' });
      const max = Number(cl.max_actions_per_day ?? 0), left = max - Number(u.count ?? 0);
      const room = BigInt(cl.daily_budget) - BigInt(u.spent ?? 0) - BigInt(u.reserved ?? 0);
      rows.push({ c, left, room });
      if (left >= max && room >= BigInt(cl.daily_budget)) break;
    } catch { /* unreadable: skip */ }
  }
  const ok = rows.sort((a, b) => b.left - a.left || (b.room > a.room ? 1 : b.room < a.room ? -1 : 0));
  return ok[0]?.c || list[0];
}
let queue = Promise.resolve();
const serial = fn => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const runner = { day: dayOf(Date.now()), used: 0 };
export const _runner = runner;
function runnerLimits(now = Date.now()) {
  if (dayOf(now) !== runner.day) { runner.day = dayOf(now); runner.used = 0; }
  const cap = Math.max(0, Number(process.env.VAULT_RUNNER_DAILY_TX ?? 150));
  const reset = new Date(runner.day + 'T00:00:00Z').getTime() + 86_400_000;
  return { gas_tgas: PROPOSE_TGAS, daily_tx_cap: cap, used_today: runner.used, left_today: Math.max(0, cap - runner.used), resets_at: new Date(reset).toISOString() };
}
/** Reserve room for up to `n` txs today, or refuse before anything is signed. */
function reserve(n) {
  const l = runnerLimits();
  if (l.left_today < n) throw bad(`shared runner reached its daily cap (${l.daily_tx_cap} txs, resets ${l.resets_at}); run it on your own charter instead`, 429);
  runner.used += n;
  return used => { runner.used -= n - used; };
}

/** Runner status for /api/health: limits plus the arena key's remaining gas allowance on chain. */
let lastRunner = null;
/** Cached runner status for /api/health (no RPC on the request path); refreshed by the warm loop. */
export const runnerStatusCached = () => lastRunner ?? (V ? { enabled: !!agentSecret(), charter: V.arena.charter, ...runnerLimits(), warming: true } : { enabled: false });
export async function refreshRunnerStatus() { lastRunner = await runnerStatus(); }
export async function runnerStatus() {
  if (!V) return { enabled: false };
  const secret = agentSecret();
  const out = { enabled: !!secret, charter: V.arena.charter, ...runnerLimits() };
  if (!secret) return out;
  try {
    const pk = keyFrom(secret).publicKey;
    const ak = await cached('ak:' + pk, 60_000, () => rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: V.arena.charter, public_key: pk }));
    const fc = ak.permission?.FunctionCall;
    out.public_key = pk; out.allowance_yocto = fc ? fc.allowance : null; out.methods = fc?.method_names ?? null;
  } catch (e) { out.allowance_error = String(e.message).slice(0, 120); }
  return out;
}

/** Run one attack on a charter with a key that may call `propose` on it. Stops at the first refusal. */
// The runner signs on the server: primary RPC first, then the fallbacks when one answers 429/5xx.
const runnerRpc = () => rpcClient([cfg.rpc, ...cfg.rpcFallbacks.filter(u => u !== cfg.rpc)]);

export async function runAttack({ charter, key, attackId, tag, rpcCall = runnerRpc(), viewF = (a, m, x) => viewFn(rpcCall, a, m, x), send = sendPropose, verify = verifyAttempt }) {
  const result = await runSteps({ charter, key, attackId, tag, rpcCall, viewF, send });
  for (const st of result.steps) st.url = explorerTx(st.tx);
  // The board only takes what the chain says: re-read the refusal like any recorded attempt.
  const last = result.steps[result.steps.length - 1];
  const v = result.refused && last?.tx ? await verify(last.tx, charter).catch(() => null) : null;
  if (last && v) { last.counted = v.counted; last.why = v.why; }
  result.counted = !!v?.counted; result.why = v ? v.why : (result.refused ? 'not_verified_yet' : 'not_refused');
  return result;
}

export async function doTask({ charter, key, taskId, tag, rpcCall = runnerRpc(), viewF = (a, m, x) => viewFn(rpcCall, a, m, x), send = sendPropose, verify = verifyAttempt }) {
  const r = await runTask({ charter, key, taskId, tag, rpcCall, viewF, send });
  r.url = explorerTx(r.tx);
  const v = r.tx ? await verify(r.tx, charter).catch(() => null) : null;
  r.counted = !!v?.counted; r.why = v?.why ?? null;
  return r;
}

export async function sharedAttack(attackId, tag) {
  if (!V) throw bad('vault not deployed', 503);
  const secret = agentSecret();
  if (!secret) throw bad('shared arena runner is off on this deployment (no agent key set)', 503);
  if (!ATTACK_IDS.includes(attackId)) throw bad('unknown attack');
  return serial(async () => {
    const release = reserve(12);
    let used = 0;
    try { const r = await runAttack({ charter: await pickShared(viewFn.bind(null, runnerRpc())), key: keyFrom(secret), attackId, tag }); used = r.steps.filter(s => s.tx).length; return { ...r, server_signed: true }; }
    catch (e) { used = (e.status && e.status < 500) ? 0 : 1; throw e; }
    finally { release(used); }
  });
}

export async function sharedTask(taskId, tag) {
  if (!V) throw bad('vault not deployed', 503);
  const secret = agentSecret();
  if (!secret) throw bad('shared arena runner is off on this deployment (no agent key set)', 503);
  if (!TASK_IDS.includes(taskId)) throw bad('unknown task');
  return serial(async () => {
    const release = reserve(1);
    let used = 0;
    try { const r = await doTask({ charter: await pickShared(viewFn.bind(null, runnerRpc())), key: keyFrom(secret), taskId, tag }); used = r.tx ? 1 : 0; return { ...r, server_signed: true }; }
    catch (e) { used = (e.status && e.status < 500) ? 0 : 1; throw e; }
    finally { release(used); }
  });
}

/** Payees a request may name: the charter's Native allowlists (when readable), then the arena merchants. */
export async function askReceivers(charter, viewF = view) {
  const out = new Set();
  if (charter) {
    const cl = await viewF(charter, 'get_clauses').catch(() => null);
    for (const c of Object.values(cl || {})) if (c?.asset === 'Native') for (const r of c.receivers || []) out.add(r);
  }
  for (const r of V?.arena?.merchants || []) out.add(r);
  return [...out];
}

/** "Ask the agent to pay" without signing: the parsed request and the proposal the owner's agent key would sign. */
export async function askPlan(text, charter = null, { viewF = view, nowMs = Date.now(), propose = agent.propose, tag = 'mine' } = {}) {
  if (!V) throw bad('vault not deployed', 503);
  if (charter !== null && !isAccount(charter)) throw bad('charter: a testnet account id');
  const id = charter || V.arena.charter;
  const clauses = await viewF(id, 'get_clauses');
  const receivers = await askReceivers(id, async () => clauses);
  let a;
  try { a = await propose(text, { clauses, receivers, tag }); } catch (e) { throw bad(e.message, e.status && e.status < 500 ? e.status : 400); }
  const q = a.parsed;
  const { id: clauseId, clause } = pickClause(clauses);
  const st = await viewF(id, 'get_state');
  return { charter: id, parsed: q, clause_id: clauseId,
    on_allowlist: (clause.receivers || []).includes(q.receiver), per_action_cap: clause.per_action_cap ?? null,
    proposal: { shop: 'ask', clause_id: clauseId, receiver: q.receiver, amount: q.amount, nonce: String(st.next_nonce),
      policy_version: st.policy_version, expires_at: String(BigInt(nowMs + 10 * 60_000) * 1_000_000n), memo: q.memo, receipt: null },
    sign: 'call `propose` on the charter with {"p": proposal} using your agent function-call key; the charter decides',
    by: a.by, model: a.model, parser: a.by === 'model' ? `NEAR AI model ${a.model} in a TEE (proposes only; the charter decides)` : a.parser,
    fallback_why: a.fallback_why || null, verification: a.verification || null, tee: a.tee || null, cost: a.cost || null };
}

/** The oath "action" event a propose tx logged (non-phantom), or null. */
export async function askEvent(rpcCall, tx, sender) {
  for (let i = 0; i < 3; i++) {
    const t = await rpcCall('tx', { tx_hash: tx, sender_account_id: sender, wait_until: 'FINAL' }).catch(() => null);
    const ev = t && eventsFromOutcome(t).events.find(e => e.standard === 'oath' && e.event === 'action');
    if (ev) return { standard: ev.standard, version: ev.version, event: ev.event, data: ev.data, executor: ev.executor };
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

/** "Ask the agent to pay" on the SHARED arena charter: one server-signed `propose`, decided on chain. */
export async function sharedAsk(text, { run = runAsk, nickname = 'guest', propose = agent.propose, viewF = view } = {}) {
  if (!V) throw bad('vault not deployed', 503);
  const secret = agentSecret();
  if (!secret) throw bad('shared arena runner is off on this deployment (no agent key set)', 503);
  let a, clauses;
  try {
    clauses = await viewF(V.arena.charter, 'get_clauses').catch(() => ({}));
    a = await propose(text, { clauses, receivers: V.arena.merchants || [], tag: nickname || 'guest' });
  } catch (e) { throw bad(e.message, e.status && e.status < 500 ? e.status : 400); }
  const q = a.parsed;
  const brain = { by: a.by, model: a.model, parser: a.parser || null, fallback_why: a.fallback_why || null,
    suspicious: q.suspicious ?? null, why_flag: q.why || null, verification: a.verification || null, cost: a.cost || null };
  return serial(async () => {
    const release = reserve(1);
    let used = 0;
    try {
      const rpcCall = runnerRpc();
      const r = await run({ charter: await pickShared((a, m, x) => viewFn(rpcCall, a, m, x)), key: keyFrom(secret), receiver: q.receiver, amount: q.amount, memo: q.memo,
        rpcCall, viewF: (a, m, x) => viewFn(rpcCall, a, m, x), send: sendPropose });
      used = r.tx ? 1 : 0;
      // The charter's own NEP-297 event for this propose, read back from the chain (the red-team view shows it as is).
      const event = r.tx ? await askEvent(rpcCall, r.tx, r.charter).catch(() => null) : null;
      const out = { ...r, note: q.note, ...brain, url: r.tx ? explorerTx(r.tx) : null, server_signed: true, event };
      return { ...out, receipt: buildReceipt(out, (clauses || {})[r.clause_id]) };
    } catch (e) { used = (e.status && e.status < 500) ? 0 : 1; throw e; }
    finally { release(used); }
  });
}

// ---------- verified attempts (LRU, persisted, rebuilt from chain) ----------
const MAX_ROWS = Number(process.env.VAULT_BOARD_MAX || 20_000);
const attempts = new Lru(MAX_ROWS); // tx hash -> verified row
const notArena = new Lru(MAX_ROWS); // tx hash -> { charter } for txs that are not arena/task rows
const nonceOf = new Lru(MAX_ROWS); // tx hash -> [charter, [propose nonces it consumed]]
const seen = new Map(); // charter -> Set of nonces held by a known tx
const pending = new Set(); // hashes loaded from the committed snapshot, not yet re-read from chain this boot
export const _attempts = attempts;
export const _notArena = notArena;
export const _pending = pending;
export const _seen = seen;

/** Nonces a tx consumed: oath's propose bumps next_nonce on every call whose own receipt succeeds (refusals too). */
export function proposeNonces(tx, charter) {
  const t = tx?.transaction;
  if (!t || t.receiver_id !== charter || t.signer_id !== charter) return [];
  const rid = tx.transaction_outcome?.outcome?.receipt_ids?.[0];
  const first = (tx.receipts_outcome || []).find(o => o.id === rid);
  if (!first || first.outcome?.status?.Failure || !('SuccessValue' in (first.outcome?.status || {}) || 'SuccessReceiptId' in (first.outcome?.status || {}))) return [];
  const out = [];
  for (const a of t.actions || []) {
    const fc = a.FunctionCall;
    if (!fc) continue;
    let args; try { args = JSON.parse(Buffer.from(fc.args, 'base64').toString('utf8')); } catch { continue; }
    if (fc.method_name === 'propose' && args?.p?.nonce != null) out.push(Number(args.p.nonce));
    if (fc.method_name === 'propose_batch' && Array.isArray(args?.ps)) for (const q of args.ps) if (q?.nonce != null) out.push(Number(q.nonce));
  }
  return out.filter(Number.isSafeInteger);
}
function noteNonces(hash, charter, ns) {
  forgetNonces(hash);
  if (!ns?.length) return;
  nonceOf.set(hash, [charter, ns]);
  let set = seen.get(charter);
  if (!set) seen.set(charter, set = new Set());
  for (const n of ns) set.add(n);
}
function forgetNonces(hash) {
  const old = nonceOf.get(hash);
  if (!old) return;
  nonceOf.delete(hash);
  const set = seen.get(old[0]);
  if (set) for (const n of old[1]) set.delete(n);
}
/** True when known txs hold every nonce 0..next-1, i.e. this charter has no propose we have not seen. */
export function covered(charter, next) {
  if (!Number.isSafeInteger(next) || next < 0) return false;
  const set = seen.get(charter);
  for (let i = 0; i < next; i++) if (!set?.has(i)) return false;
  return true;
}
const BOARD_FILE = process.env.VAULT_BOARD_FILE || '/tmp/nearcarta-vault-board.json';
const ROW_VERSION = 3;
const SNAPSHOT_FILE = process.env.VAULT_SNAPSHOT_FILE || new URL('../data/vault-board-snapshot.json', import.meta.url).pathname;
let saveTimer = null;
function scheduleSave() {
  if (process.env.NODE_ENV === 'test' || saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveBoard(); }, 2000);
  saveTimer.unref?.();
}
export function saveBoard(file = BOARD_FILE) {
  try {
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(boardData()));
    renameSync(tmp, file); return true;
  } catch { return false; }
}
export function boardData() {
  return { version: ROW_VERSION, factory: V?.factory, rows: [...attempts.values()],
    skip: [...notArena.entries()].map(([k, v]) => [k, v?.charter ?? null]), nonces: [...nonceOf.entries()] };
}
/** Load a saved board. With `snapshot`, every hash is also queued to be re-read from chain (see reread). */
export function loadBoard(file = BOARD_FILE, { snapshot = false } = {}) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (j.version !== ROW_VERSION) return 0;
    let n = 0;
    for (const r of j.rows || []) if (r?.hash && !attempts.has(r.hash)) { attempts.set(r.hash, r); n++; if (snapshot) pending.add(r.hash); }
    for (const e of j.skip || []) { const [h, c] = Array.isArray(e) ? e : [e, null]; if (h && !notArena.has(h) && !attempts.has(h)) { notArena.set(h, { charter: c }); if (snapshot && c) pending.add(h); } }
    for (const [h, [c, ns]] of j.nonces || []) if (!nonceOf.has(h)) noteNonces(h, c, ns);
    return n;
  } catch { return 0; }
}
export const loadSnapshot = (file = SNAPSHOT_FILE) => loadBoard(file, { snapshot: true });
function remember(a) { attempts.set(a.hash, a); notArena.delete(a.hash); pending.delete(a.hash); scheduleSave(); }

async function blockTimeMs(blockHash) {
  try { const b = await rpc('block', { block_id: blockHash }); return Math.floor(Number(BigInt(b.header.timestamp_nanosec) / 1_000_000n)); } catch { return null; }
}

/** The clause as it stood at a block (regular RPC, then archival for older blocks). */
export async function clauseAt(charter, clauseId, blockHash) {
  const params = { request_type: 'call_function', block_id: blockHash, account_id: charter, method_name: 'get_clauses', args_base64: Buffer.from('{}').toString('base64') };
  let res;
  try { res = await rpc('query', params); } catch { res = await rpc('query', params, ARCHIVAL); }
  const all = JSON.parse(Buffer.from(res.result).toString('utf8'));
  return all?.[clauseId] ?? null;
}

const sha256hex = s => createHash('sha256').update(s, 'utf8').digest('hex');

/** An honest request counts when the charter allowed and settled it to an allowlisted payee within the clause limits. */
export const HONEST_ASK = { id: 'honest-ask', name: 'Your own honest request', expects: 'allowed' };
/** A free-text request the charter refused (a scam the guest typed) scores once as a blocked scam. */
export const OWN_SCAM = { id: 'own-scam', name: 'Your own scam text', expects: 'refused' };
export function askWhy(a, cl, settle) {
  if (a.decision === 'denied') return a.reason ? null : 'no_reason';
  if (a.decision !== 'allowed') return 'not_allowed';
  let amt; try { amt = BigInt(a.amount); } catch { return 'not_on_allowlist_or_over_cap'; }
  if (!(cl.receivers || []).includes(a.receiver) || amt > BigInt(cl.per_action_cap) || amt < BigInt(cl.min_amount ?? '1')) return 'not_on_allowlist_or_over_cap';
  if (settle && settle.data[0].reason !== 'ok') return 'payment_failed';
  return null;
}

/**
 * Re-read one tx from chain. Returns null when it is not an arena or task propose on a factory
 * charter running its audited oath; otherwise a row whose `counted` says whether it scores and
 * `why` says why not.
 */
export async function verifyAttempt(hash, charter, { status = txStatus, facts = charterFacts, blockTime = blockTimeMs, clause = clauseAt, strict = false } = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) || !isAccount(charter)) throw bad('bad tx hash or charter');
  if (attempts.has(hash)) return attempts.get(hash);
  const f = await facts(charter);
  if (!f.registered || !f.runs_r14) return null;
  const tx = await status(hash, charter);
  noteNonces(hash, charter, proposeNonces(tx, charter));
  const t = tx.transaction;
  if (t.signer_id !== charter || t.receiver_id !== charter || t.actions?.length !== 1) return null;
  const fc = t.actions[0].FunctionCall;
  if (!fc || fc.method_name !== 'propose') return null;
  let p;
  try { p = JSON.parse(Buffer.from(fc.args, 'base64').toString('utf8')).p; } catch { return null; }
  const memo = typeof p?.memo === 'string' ? p.memo : '';
  const am = MEMO_RE.exec(memo), tm = TASK_MEMO_RE.exec(memo), km = ASK_MEMO_RE.exec(memo);
  const kind = am && ATTACK_IDS.includes(am[2]) ? 'attack' : tm && TASK_IDS.includes(tm[2]) ? 'task' : km ? 'ask' : null;
  if (!kind) return null;
  const { events } = eventsFromOutcome(tx);
  const ev = events.find(e => e.standard === 'oath' && e.event === 'action' && e.executor === charter);
  if (!ev) return null;
  const d = ev.data?.[0] || {};
  const m = kind === 'attack' ? am : kind === 'task' ? tm : km;
  const id = m[2];
  const a = { hash, charter, owner: f.owner, kind, [kind]: id, tag: m[1],
    decision: d.decision, reason: d.reason || null, receiver: d.receiver ?? null, amount: d.amount ?? null, clause_id: d.clause_id ?? null,
    shared: isShared(charter), server_signed: isShared(charter), counted: false, why: null, at: null };
  if (kind === 'attack') a.expects = acceptedReasons(id);
  // The logged memo hash must be this memo (the event, not the args, is what the contract judged).
  if (d.memo_hash && d.memo_hash !== sha256hex(memo)) a.why = 'memo_mismatch';
  const rcpt = (tx.receipts_outcome || []).find(o => o.id === ev.receipt_id);
  const bh = rcpt?.block_hash || tx.transaction_outcome?.block_hash;
  let cl = null;
  if (!a.why) {
    try { cl = bh && a.clause_id ? await clause(charter, a.clause_id, bh) : null; } catch { cl = undefined; }
    if (cl === undefined) { if (strict) throw bad('chain busy: clause not readable', 503); return null; } // RPC trouble: no verdict, retry later
    if (!cl) a.why = 'clause_unknown';
  }
  if (!a.why && kind === 'attack') {
    if (a.decision !== 'denied') a.why = 'not_refused';
    else if (!a.expects.includes(a.reason)) a.why = 'wrong_reason';
    else if (!matchesPlan(id, a, cl)) a.why = 'not_the_attack_plan';
  }
  if (!a.why && kind === 'task') {
    const settle = events.find(e => e.standard === 'oath' && e.event === 'settle' && e.executor === charter && e.data?.[0]?.action_id === d.action_id);
    if (a.decision !== 'allowed') a.why = 'not_allowed';
    else if (!matchesTask(id, a, cl)) a.why = 'not_the_task_plan';
    else if (settle && settle.data[0].reason !== 'ok') a.why = 'payment_failed';
  }
  if (!a.why && kind === 'ask') a.why = askWhy(a, cl, events.find(e => e.standard === 'oath' && e.event === 'settle' && e.executor === charter && e.data?.[0]?.action_id === d.action_id));
  a.counted = !a.why;
  const tb = tx.transaction_outcome?.block_hash;
  if (tb) a.at = await blockTime(tb);
  remember(a);
  return a;
}

/** One page of the tx index through the shared gate, at low priority: page feeds go first, and a busy index
 * ends this pass (the next pass retries) instead of holding the IP's quota. Tests pass `f` and a short `waitMs`. */
async function indexPage(body, f = fetch, waitMs = 1500) {
  return indexPost('/v0/account', body, { prio: 'low', f, baseMs: waitMs, tries: 4, deadlineMs: 20_000 + waitMs * 16 });
}
export async function charterTxs(charter, { maxPages = 50, f = fetch, waitMs } = {}) {
  const out = [];
  let resume = null;
  for (let i = 0; i < maxPages; i++) {
    const j = await indexPage({ account_id: charter, is_signer: true, limit: 200, ...(resume ? { resume_token: resume } : {}) }, f, waitMs);
    out.push(...(j.account_txs || []).filter(x => x.is_signer && x.is_receiver && x.is_function_call)
      .map(x => ({ hash: x.transaction_hash, at: Math.floor(Number(BigInt(x.tx_block_timestamp) / 1_000_000n)) })));
    resume = j.resume_token;
    if (!resume || !(j.account_txs || []).length) return out;
  }
  throw new Error('tx index: more than ' + maxPages + ' pages');
}

/** Every charter of a factory, page by page up to its on-chain count. */
export async function allCharters(factory) {
  const out = [];
  for (let from = 0; ; from += 100) {
    const r = await listCharters(from, 100, factory);
    out.push(...r.charters);
    if (r.charters.length < 100 || out.length >= r.count) return out;
  }
}

/** Run `fn` over `items` with at most `n` in flight. */
export async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } }));
}
/** The charter's on-chain propose counter (oath get_state.next_nonce); null when it has none or is unreadable. */
export async function nextNonce(charter) {
  try { const st = await view(charter, 'get_state'); const n = Number(st?.next_nonce); return Number.isSafeInteger(n) ? n : null; } catch { return null; }
}
/** Tx hashes this server holds for a charter (verified rows, skipped txs, nonce owners): a feed source that needs no index. */
export function knownTxs(charter) {
  const out = new Set();
  for (const a of attempts.values()) if (a?.charter === charter) out.add(a.hash);
  for (const [h, v] of nonceOf.entries()) if (v?.[0] === charter) out.add(h);
  return [...out];
}

/**
 * Rebuild the board from chain. A charter is complete when known txs hold every propose nonce 0..next_nonce-1 (oath
 * bumps next_nonce on every propose whose own receipt succeeds, refusals too), so most charters need one view call and
 * no index at all; only a charter with a gap is read from the tx index (low priority), and its new txs are re-verified
 * on RPC (bounded per call). A charter whose gap the index cannot explain (e.g. a relayed propose, not signed by the
 * charter) is complete once the index was read in full. `complete` is true only when every charter list was read and
 * every charter is complete; any error leaves it false.
 */
export async function backfill({ budget = 40, factories = FACTORIES, charters = allCharters, txs = c => cached('txs:' + c, 30_000, () => charterTxs(c)),
  verify = (h, c) => verifyAttempt(h, c, { strict: true }), next = nextNonce, conc = 6 } = {}) {
  let checked = 0, errors = 0, byNonce = 0, byIndex = 0, over = false;
  const list = [];
  for (const fa of factories) {
    try { list.push(...await charters(fa.factory)); } catch { errors++; }
  }
  // The shared arena first: it holds most rows, so a partial rebuild still shows the busiest charter.
  list.sort((a, b) => Number(isShared(b.charter)) - Number(isShared(a.charter)));
  await pool(list, conc, async c => {
    const n = await next(c.charter);
    if (n !== null && covered(c.charter, n)) { byNonce++; return; }
    let ts;
    try { ts = await txs(c.charter); } catch { errors++; return; }
    for (const t of ts) {
      if (notArena.has(t.hash)) continue;
      if (attempts.has(t.hash)) { const a = attempts.get(t.hash); if (a && !a.at) a.at = t.at; continue; }
      if (checked >= budget) { over = true; return; }
      checked++;
      try { const a = await verify(t.hash, c.charter); if (a) { if (!a.at) a.at = t.at; } else { notArena.set(t.hash, { charter: c.charter }); scheduleSave(); } } catch { errors++; }
    }
    byIndex++;
  });
  return { checked, errors, complete: errors === 0 && !over, charters: list.length, by_nonce: byNonce, by_index: byIndex };
}

/**
 * Re-read one snapshot hash from chain and replace what the snapshot said about it. On RPC trouble the snapshot entry
 * stays (and stays pending); a hash that is no longer an arena row on chain moves to the skip list.
 */
export async function reread(hash, { verify = (h, c) => verifyAttempt(h, c, { strict: true }) } = {}) {
  const old = attempts.get(hash), skip = notArena.get(hash), nn = nonceOf.get(hash);
  const charter = old?.charter ?? skip?.charter ?? nn?.[0];
  if (!charter) { pending.delete(hash); return null; }
  attempts.delete(hash); notArena.delete(hash); // nonces stay until verify re-notes them (no coverage gap meanwhile)
  try {
    const a = await verify(hash, charter);
    if (!a) notArena.set(hash, { charter });
    if (old && (!a || a.counted !== old.counted || a.why !== old.why)) rebuild.changed++;
    pending.delete(hash); scheduleSave();
    return a;
  } catch (e) {
    if (old) attempts.set(hash, old);
    if (skip) notArena.set(hash, skip);
    if (nn && !nonceOf.has(hash)) noteNonces(hash, nn[0], nn[1]);
    throw e;
  }
}

export const rebuild = { started_at: null, complete_at: null, reread_at: null, passes: 0, rows: 0, snapshot_rows: 0, pending: 0, changed: 0, last: null };
/**
 * Load the saved board (this instance) and the committed snapshot (tx hashes and nonces; every one re-read from chain
 * below), then fill until a pass completes (backoff to 60 s) while the snapshot hashes are re-read in parallel.
 */
export function boot({ fill = backfill, firstMs = 1000, snapshotFile, boardFile = BOARD_FILE, reread: rr = reread, conc = 6 } = {}) {
  if (!V) return;
  // On Render free (no disk) the /tmp board is gone after a restart: the fill below rebuilds it from chain.
  rebuild.board_file_rows = loadBoard(boardFile);
  rebuild.snapshot_rows = snapshotFile === null ? 0 : loadSnapshot(snapshotFile);
  rebuild.started_at = Date.now();
  rebuild.pending = pending.size;
  let wait = 1500;
  const step = async () => {
    const r = await fill({ budget: 60 }).catch(() => ({ complete: false, errors: 1 }));
    rebuild.passes++; rebuild.rows = attempts.size; rebuild.last = r;
    if (r.complete) { rebuild.complete_at = Date.now(); return; }
    wait = r.errors ? Math.min(60_000, wait * 2) : 1500; // budget used up: go on; index trouble: back off
    setTimeout(step, wait).unref?.();
  };
  let rwait = 2000;
  const check = async () => {
    // Arena rows first, then the rest; failures stay pending for the next round.
    const list = [...pending].sort((x, y) => Number(isShared(attempts.get(y)?.charter || '')) - Number(isShared(attempts.get(x)?.charter || '')));
    const before = pending.size;
    await pool(list, conc, h => rr(h).catch(() => {}));
    rebuild.pending = pending.size;
    if (!pending.size) { rebuild.reread_at = Date.now(); return; }
    rwait = pending.size < before ? 2000 : Math.min(60_000, rwait * 2); // progress: go on soon; no progress: back off
    setTimeout(check, rwait).unref?.();
  };
  setTimeout(step, firstMs).unref?.();
  if (pending.size) setTimeout(check, firstMs).unref?.();
  else rebuild.reread_at = Date.now();
}

/** Visitor charters allowed on the public board. Shared-arena nicknames are not on this list. */
export const PUBLIC_CHARTERS = new Set((publicCharters.charters || []).map(id => String(id).toLowerCase()));
export function isPublicPlayer(p, allow = PUBLIC_CHARTERS) {
  return (p?.charters || []).some(id => allow.has(String(id).toLowerCase()));
}
export function publicPlayers(list, allow = PUBLIC_CHARTERS) {
  const rows = board(list);
  const players = rows.filter(p => isPublicPlayer(p, allow)).map(p => ({ ...p, network: 'testnet' }));
  return { players, hidden: rows.length - players.length };
}

export function board(list = [...attempts.values()]) {
  const players = new Map();
  for (const a of list) {
    if (!a) continue;
    const key = a.shared ? `nick:${a.tag}` : `owner:${a.owner}`;
    const p = players.get(key) || { player: a.shared ? a.tag : a.owner, verified: !a.shared, server_signed: !!a.server_signed,
      charters: new Set(), patterns: new Set(), tasks: new Set(), refusals: 0, tasks_passed: 0, attempts: 0, not_counted: 0, last_tx: null, last_at: 0 };
    p.attempts++; p.charters.add(a.charter);
    if (a.counted && a.kind === 'task') { p.tasks_passed++; p.tasks.add(a.task); }
    else if (a.counted && a.kind === 'ask' && a.decision === 'denied') { p.refusals++; p.patterns.add(OWN_SCAM.id); }
    else if (a.counted && a.kind === 'ask') { p.tasks_passed++; p.tasks.add(HONEST_ASK.id); }
    else if (a.counted) { p.refusals++; p.patterns.add(a.attack); }
    else if (a.kind === 'task' || a.kind === 'ask' || a.decision === 'denied') p.not_counted++;
    if ((a.at || 0) >= p.last_at) { p.last_at = a.at || 0; p.last_tx = a.hash; }
    players.set(key, p);
  }
  return [...players.values()].map(p => ({ ...p, charters: [...p.charters], patterns: [...p.patterns].sort(), tasks: [...p.tasks].sort(),
    pattern_count: p.patterns.size, task_count: p.tasks.size, score: p.patterns.size + p.tasks.size, max_score: ATTACKS.length + 1 + TASKS.length + 1 }))
    .sort((x, y) => y.score - x.score || y.pattern_count - x.pattern_count || y.refusals - x.refusals || x.last_at - y.last_at);
}

const RULE = 'The public board lists only the visitor charters named in shared/vault/public-charters.json. Every other row stays off it. ' +
  'Rows are final testnet propose txs on factory charters running their audited oath release, re-read from chain. ' +
  'An attack scores only if the contract refused it with the reason that attack targets, and its logged payee and amount match the attack plan under the clause in force at that block. ' +
  'A task scores only if the contract allowed and settled the planned allowlisted payment. ' +
  'One honest request of your own (memo ask:<nickname>:<note>) scores once per player if the contract allowed and settled it to a payee on the clause allowlist, within its cap. A request of your own that the contract refused (a scam you typed) scores once as a blocked scam. Memos are labels, never proof. ' +
  'Own-charter rows are keyed by the charter owner (verified); shared-charter rows are signed by this server\'s runner (server_signed) and keyed by nickname.';

// Pages never wait long on the index: refresh in the background, answer from the rows already verified.
let lastFill = { complete: false };
export async function refreshBoard(waitMs = 2500, fill = () => cached('backfill', 20_000, () => backfill())) {
  const p = Promise.resolve().then(fill).then(r => (lastFill = r), () => lastFill);
  let t; const timeout = new Promise(r => { t = setTimeout(() => r(lastFill), waitMs); t.unref?.(); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t); }
}
export async function leaderboard() {
  if (!V) throw bad('vault not deployed', 503);
  const fill = await refreshBoard();
  const rows = [...attempts.values()];
  const pub = publicPlayers(rows);
  return { rule: RULE, indexed: rows.length, counted: rows.filter(r => r.counted).length, complete: fill.complete, rebuilt: { ...rebuild, pending: pending.size },
    network: 'testnet', seed_hidden: pub.hidden, players: pub.players.slice(0, 50),
    empty: 'No visitor charters on the public board yet. A row appears only when its charter is listed. Test runs stay off it.',
    recent: rows.filter(a => isPublicPlayer({ charters: [a.charter] })).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 20).map(a => ({ ...a, url: explorerTx(a.hash) })) };
}

/** One charter's scorecard: each task (should be allowed) and each attack (should be refused). */
export async function score(charter) {
  if (!V) throw bad('vault not deployed', 503);
  if (!isAccount(charter)) throw bad('bad account id');
  await refreshBoard();
  const rows = [...attempts.values()].filter(r => r.charter === charter).sort((a, b) => (b.at || 0) - (a.at || 0));
  const best = pick => { const all = rows.filter(pick); const r = all.find(x => x.counted) || all[0]; return r ? { counted: r.counted, why: r.why, decision: r.decision, reason: r.reason, tx: r.hash, url: explorerTx(r.hash), tries: all.length } : null; };
  const tasks = [...TASKS.map(t => ({ id: t.id, name: t.name, expects: 'allowed', result: best(r => r.kind === 'task' && r.task === t.id) })),
    { ...HONEST_ASK, result: best(r => r.kind === 'ask' && r.decision !== 'denied') }];
  const attacks = [...ATTACKS.map(x => ({ id: x.id, name: x.name, expects: acceptedReasons(x.id), result: best(r => r.kind === 'attack' && r.attack === x.id && r.decision === 'denied') })),
    { ...OWN_SCAM, result: best(r => r.kind === 'ask' && r.decision === 'denied') }];
  const passed = tasks.filter(t => t.result?.counted).length, blocked = attacks.filter(a => a.result?.counted).length;
  return { charter, shared: isShared(charter), tasks_passed: passed, scams_blocked: blocked, score: passed + blocked, max_score: tasks.length + attacks.length, tasks, attacks, rule: RULE };
}

/** Catalog of tasks and attacks; with a charter, the exact steps each would sign right now. */
export async function catalog(charter) {
  const out = { tasks: TASKS, attacks: ATTACKS.map(a => ({ ...a, accepts: acceptedReasons(a.id) })), memo: { task: 'task:<nickname>:<task-id>', attack: 'arena:<nickname>:<attack-id>', ask: 'ask:<nickname>:<note>' },
    honest_ask: HONEST_ASK,
    order: 'Run the tasks first: attacks spend the daily budget and action count, after which an honest task is refused too.' };
  if (!charter) return out;
  if (!isAccount(charter)) throw bad('bad account id');
  const clauses = await view(charter, 'get_clauses');
  const { id: clauseId, clause } = pickClause(clauses);
  const u = await view(charter, 'get_usage', { clause_id: clauseId });
  const used = { spent: (BigInt(u.spent) + BigInt(u.reserved || 0)).toString(), count: u.count };
  const tryPlan = fn => { try { return { steps: fn() }; } catch (e) { return { error: e.message }; } };
  out.charter = charter; out.clause_id = clauseId; out.clause = clause; out.usage = u;
  out.plans = { tasks: Object.fromEntries(TASK_IDS.map(id => [id, tryPlan(() => [planTask(id, clause, used)])])),
    attacks: Object.fromEntries(ATTACK_IDS.map(id => [id, tryPlan(() => plan(id, clause, used))])) };
  return out;
}

export function register(app, { limiter, globalCap }) {
  if (process.env.NODE_ENV !== 'test') boot();
  app.get('/api/vault/config', limiter(240), edgeCache(60), c => c.json(config()));
  app.get('/api/vault/charters', limiter(30), async c => c.json(await listCharters(c.req.query('from'), c.req.query('limit'))));
  app.get('/api/vault/charter/:id', limiter(30), async c => {
    const fresh = c.req.query('fresh') === '1';
    const f = await charterFacts(c.req.param('id'), { fresh });
    const v = fresh ? freshView : view;
    let use = null;
    if (f.runs_r14 && f.clauses) use = Object.fromEntries(await Promise.all(Object.keys(f.clauses).map(async k => [k, await usage(f.charter, k, v).catch(() => null)])));
    return c.json({ ...f, usage: use });
  });
  app.get('/api/vault/tasks', limiter(30), async c => c.json(await catalog(c.req.query('charter') || null)));
  app.post('/api/vault/attack', limiter(6), globalCap('vault-attack', 30), async c => {
    const b = await c.req.json().catch(() => ({}));
    return c.json(await sharedAttack(String(b.attack || ''), String(b.nickname || '').toLowerCase()));
  });
  app.post('/api/vault/task', limiter(6), globalCap('vault-attack', 30), async c => {
    const b = await c.req.json().catch(() => ({}));
    return c.json(await sharedTask(String(b.task || ''), String(b.nickname || '').toLowerCase()));
  });
  // The NEAR AI model proposes (backend/src/agent.js); spend is capped per guest (8/min, 40/day) and globally.
  const askPerDay = limiter(Number(process.env.AGENT_PER_GUEST_DAY || 40), 24 * 3600e3, { persist: 'ask-day' });
  const agentCap = globalCap('nearai-agent', Number(process.env.CAP_AGENT_PER_MIN || 20));
  app.get('/api/agent/budget', limiter(30), c => c.json(agent.budgetStatus()));
  app.post('/api/vault/ask/plan', limiter(8), askPerDay, agentCap, async c => {
    const b = await c.req.json().catch(() => ({}));
    const tag = String(b.nickname || '').toLowerCase() || 'mine';
    return c.json(await askPlan(String(b.text || ''), b.charter == null || b.charter === '' ? null : String(b.charter), { tag }));
  });
  app.post('/api/vault/ask', limiter(6), askPerDay, agentCap, globalCap('vault-attack', 30), async c => {
    const b = await c.req.json().catch(() => ({}));
    return c.json(await sharedAsk(String(b.text || ''), { nickname: String(b.nickname || '').toLowerCase() || 'guest' }));
  });
  app.post('/api/vault/record', limiter(30), async c => {
    const b = await c.req.json().catch(() => ({}));
    const a = await verifyAttempt(String(b.tx || ''), String(b.charter || ''));
    if (!a) return c.json({ error: 'not an arena attack or agent task on a factory charter (or chain not readable yet)' }, 422);
    return c.json({ ...a, url: explorerTx(a.hash) });
  });
  app.get('/api/vault/score/:charter', limiter(20), async c => c.json(await score(c.req.param('charter'))));
  // Bare path (cited by older notes): ?charter= works as an alias; without it, a usage hint instead of a 404.
  app.get('/api/vault/score', limiter(20), async c => {
    const id = c.req.query('charter');
    if (id) return c.json(await score(id));
    return c.json({ usage: 'GET /api/vault/score/:charter or /api/vault/score?charter=<account>', example: '/api/vault/score/' + (V.arena?.charter || '<charter>') });
  });
  app.get('/api/vault/leaderboard', limiter(20), async c => c.json(await leaderboard()));
  app.get('/api/vault/runner', limiter(30), async c => c.json(await runnerStatus()));
}
