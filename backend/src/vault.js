// Charters and Vault Arena. Charters come from the factory on chain; every arena result is a
// final testnet tx, and the leaderboard is rebuilt from chain (factory list + each charter's
// propose txs, each one re-verified through RPC).
//
// Scoring never trusts the memo. The memo only says which attack or task a tx claims to be; the
// row counts only if the contract's own `action` event shows the planned payee and amount for that
// attack or task under the clause in force at that block, and the expected decision:
//   attack -> denied, with the reason the attack targets;   task -> allowed and settled ok.
//
// Exception to "no route can sign": POST /api/vault/attack and /api/vault/task sign `propose` on
// the SHARED arena charter with ARENA_AGENT_KEY. That key is a function-call key that can only call
// `propose` on that one charter, with a gas allowance; the charter's clause (allowlist, small caps,
// daily budget) bounds what an allowed step can move. The runner signs at 30 Tgas and stops at a
// daily tx cap. The key is read lazily and never logged or returned. Rows it signs are labelled
// server_signed.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEP, cfg } from './config.js';
import { rpc, view, viewAccount, accessKeys, txStatus, eventsFromOutcome, explorerTx } from './near.js';
import { ATTACKS, ATTACK_IDS, MEMO_RE, acceptedReasons, matchesPlan, pickClause, plan } from '../../shared/vault/attacks.js';
import { TASKS, TASK_IDS, TASK_MEMO_RE, matchesTask, planTask } from '../../shared/vault/tasks.js';
import { keyFrom, sendPropose, rpcClient, PROPOSE_TGAS } from '../../shared/vault/tx.js';
import { runSteps, runTask } from '../../shared/vault/run.js';

export const V = DEP.vault || null;
const ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const isAccount = a => typeof a === 'string' && ACCOUNT_RE.test(a);
const ARCHIVAL = process.env.ARCHIVAL_RPC || 'https://archival-rpc.testnet.fastnear.com';

/** Factories whose charters count: the live one first, then earlier releases (kept for history). */
const FACTORIES = V ? [{ factory: V.factory, code_hash: V.code_hash }, ...(V.legacy || []).map(l => ({ factory: l.factory, code_hash: l.code_hash }))] : [];

export function config() {
  if (!V) throw bad('vault not deployed on this network', 503);
  return { network: DEP.network, factory: V.factory, code_hash: V.code_hash, factory_sha256: V.factory_sha256,
    min_deposit: V.min_deposit, policy_delay: V.policy_delay || null,
    arena: { charter: V.arena.charter, merchants: V.arena.merchants, owner: V.arena.owner },
    attacks: ATTACKS, tasks: TASKS, explorer: DEP.explorer, rpc: cfg.rpc, proof_txs: V.proof_txs, legacy: V.legacy || [],
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

export async function charterFacts(id, { fresh = false } = {}) {
  if (!V) throw bad('vault not deployed', 503);
  if (!isAccount(id)) throw bad('bad account id');
  if (fresh) cache.delete('facts:' + id);
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
      try { state = await view(id, 'get_state'); clauses = await view(id, 'get_clauses'); pendingChanges = await view(id, 'get_pending'); } catch { pending = true; }
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

export async function usage(id, clauseId) { return view(id, 'get_usage', { clause_id: clauseId }); }

export async function listCharters(from = 0, limit = 50, factory = V?.factory) {
  if (!V) throw bad('vault not deployed', 503);
  const f = Math.max(0, Number(from) || 0), l = Math.min(100, Math.max(1, Number(limit) || 50));
  return cached(`list:${factory}:${f}:${l}`, 10_000, async () => {
    const [config, rows] = await Promise.all([view(factory, 'get_config'), view(factory, 'list', { from_index: f, limit: l })]);
    return { factory, count: config.count, code_hash: config.code_hash,
      charters: rows.map(([charter, c]) => ({ charter, owner: c.owner, created_at: c.created_at, index: c.index,
        policy_delay_ns: c.policy_delay_ns ?? null, dao: c.dao ?? null, shared: charter === V.arena.charter })) };
  });
}

// ---------- the shared arena runner (30 Tgas, daily tx cap) ----------
function agentSecret() { return (process.env.ARENA_AGENT_KEY || '').trim() || null; }
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
export async function runAttack({ charter, key, attackId, tag, rpcCall = rpcClient(cfg.rpc), viewF = view, send = sendPropose, verify = verifyAttempt }) {
  const result = await runSteps({ charter, key, attackId, tag, rpcCall, viewF, send });
  for (const st of result.steps) st.url = explorerTx(st.tx);
  // The board only takes what the chain says: re-read the refusal like any recorded attempt.
  const last = result.steps[result.steps.length - 1];
  const v = result.refused && last?.tx ? await verify(last.tx, charter).catch(() => null) : null;
  if (last && v) { last.counted = v.counted; last.why = v.why; }
  result.counted = !!v?.counted; result.why = v?.why ?? (result.refused ? 'not_verified_yet' : 'not_refused');
  return result;
}

export async function doTask({ charter, key, taskId, tag, rpcCall = rpcClient(cfg.rpc), viewF = view, send = sendPropose, verify = verifyAttempt }) {
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
    try { const r = await runAttack({ charter: V.arena.charter, key: keyFrom(secret), attackId, tag }); used = r.steps.filter(s => s.tx).length; return { ...r, server_signed: true }; }
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
    try { const r = await doTask({ charter: V.arena.charter, key: keyFrom(secret), taskId, tag }); used = r.tx ? 1 : 0; return { ...r, server_signed: true }; }
    catch (e) { used = (e.status && e.status < 500) ? 0 : 1; throw e; }
    finally { release(used); }
  });
}

// ---------- verified attempts (LRU, persisted, rebuilt from chain) ----------
const MAX_ROWS = Number(process.env.VAULT_BOARD_MAX || 20_000);
const attempts = new Lru(MAX_ROWS); // tx hash -> verified row
const notArena = new Lru(MAX_ROWS); // tx hashes that are not arena/task rows
export const _attempts = attempts;
export const _notArena = notArena;
const BOARD_FILE = process.env.VAULT_BOARD_FILE || '/tmp/nearcarta-vault-board.json';
const ROW_VERSION = 2;
let saveTimer = null;
function scheduleSave() {
  if (process.env.NODE_ENV === 'test' || saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveBoard(); }, 2000);
  saveTimer.unref?.();
}
export function saveBoard(file = BOARD_FILE) {
  try {
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify({ version: ROW_VERSION, factory: V?.factory, rows: [...attempts.values()], skip: [...notArena.entries()].map(([k]) => k) }));
    renameSync(tmp, file); return true;
  } catch { return false; }
}
export function loadBoard(file = BOARD_FILE) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (j.version !== ROW_VERSION) return 0;
    for (const r of j.rows || []) if (r?.hash) attempts.set(r.hash, r);
    for (const h of j.skip || []) notArena.set(h, 1);
    return attempts.size;
  } catch { return 0; }
}
function remember(a) { attempts.set(a.hash, a); notArena.delete(a.hash); scheduleSave(); }

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

/**
 * Re-read one tx from chain. Returns null when it is not an arena or task propose on a factory
 * charter running its audited oath; otherwise a row whose `counted` says whether it scores and
 * `why` says why not.
 */
export async function verifyAttempt(hash, charter, { status = txStatus, facts = charterFacts, blockTime = blockTimeMs, clause = clauseAt } = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) || !isAccount(charter)) throw bad('bad tx hash or charter');
  if (attempts.has(hash)) return attempts.get(hash);
  const f = await facts(charter);
  if (!f.registered || !f.runs_r14) return null;
  const tx = await status(hash, charter);
  const t = tx.transaction;
  if (t.signer_id !== charter || t.receiver_id !== charter || t.actions?.length !== 1) return null;
  const fc = t.actions[0].FunctionCall;
  if (!fc || fc.method_name !== 'propose') return null;
  let p;
  try { p = JSON.parse(Buffer.from(fc.args, 'base64').toString('utf8')).p; } catch { return null; }
  const memo = typeof p?.memo === 'string' ? p.memo : '';
  const am = MEMO_RE.exec(memo), tm = TASK_MEMO_RE.exec(memo);
  const kind = am && ATTACK_IDS.includes(am[2]) ? 'attack' : tm && TASK_IDS.includes(tm[2]) ? 'task' : null;
  if (!kind) return null;
  const { events } = eventsFromOutcome(tx);
  const ev = events.find(e => e.standard === 'oath' && e.event === 'action' && e.executor === charter);
  if (!ev) return null;
  const d = ev.data?.[0] || {};
  const id = kind === 'attack' ? am[2] : tm[2];
  const a = { hash, charter, owner: f.owner, kind, [kind]: id, tag: kind === 'attack' ? am[1] : tm[1],
    decision: d.decision, reason: d.reason || null, receiver: d.receiver ?? null, amount: d.amount ?? null, clause_id: d.clause_id ?? null,
    shared: charter === V.arena.charter, server_signed: charter === V.arena.charter, counted: false, why: null, at: null };
  if (kind === 'attack') a.expects = acceptedReasons(id);
  // The logged memo hash must be this memo (the event, not the args, is what the contract judged).
  if (d.memo_hash && d.memo_hash !== sha256hex(memo)) a.why = 'memo_mismatch';
  const rcpt = (tx.receipts_outcome || []).find(o => o.id === ev.receipt_id);
  const bh = rcpt?.block_hash || tx.transaction_outcome?.block_hash;
  let cl = null;
  if (!a.why) {
    try { cl = bh && a.clause_id ? await clause(charter, a.clause_id, bh) : null; } catch { cl = undefined; }
    if (cl === undefined) return null; // RPC trouble: don't cache a verdict, retry later
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
  a.counted = !a.why;
  const tb = tx.transaction_outcome?.block_hash;
  if (tb) a.at = await blockTime(tb);
  remember(a);
  return a;
}

const FASTNEAR_TX = process.env.FASTNEAR_TX_API || 'https://tx.test.fastnear.com';
async function charterTxs(charter, maxPages = 5) {
  const out = [];
  let resume = null;
  for (let i = 0; i < maxPages; i++) {
    const r = await fetch(`${FASTNEAR_TX}/v0/account`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: charter, is_signer: true, limit: 200, ...(resume ? { resume_token: resume } : {}) }) });
    if (!r.ok) throw new Error('tx index http ' + r.status);
    const j = await r.json();
    out.push(...(j.account_txs || []).filter(x => x.is_signer && x.is_receiver && x.is_function_call)
      .map(x => ({ hash: x.transaction_hash, at: Math.floor(Number(BigInt(x.tx_block_timestamp) / 1_000_000n)) })));
    resume = j.resume_token;
    if (!resume || !(j.account_txs || []).length) break;
  }
  return out;
}

/** Pull each charter's propose txs from the index, verify the new ones on RPC (bounded per call). */
export async function backfill({ budget = 40 } = {}) {
  let checked = 0;
  for (const fa of FACTORIES) {
    let charters = [];
    try { charters = (await listCharters(0, 100, fa.factory)).charters; } catch { continue; }
    for (const c of charters) {
      let txs = [];
      try { txs = await cached('txs:' + c.charter, 30_000, () => charterTxs(c.charter)); } catch { continue; }
      for (const t of txs) {
        if (notArena.has(t.hash)) continue;
        if (attempts.has(t.hash)) { const a = attempts.get(t.hash); if (a && !a.at) a.at = t.at; continue; }
        if (checked >= budget) return { checked, complete: false };
        checked++;
        try { const a = await verifyAttempt(t.hash, c.charter); if (a) { if (!a.at) a.at = t.at; } else { notArena.set(t.hash, 1); scheduleSave(); } } catch { /* retry next time */ }
      }
    }
  }
  return { checked, complete: true };
}

/** Load the saved board, then keep filling from chain in the background until complete. */
export function boot({ loops = 30 } = {}) {
  if (!V) return;
  loadBoard();
  let n = 0;
  const step = async () => {
    const r = await backfill({ budget: 60 }).catch(() => ({ complete: false }));
    if (!r.complete && ++n < loops) setTimeout(step, 1500).unref?.();
  };
  setTimeout(step, 1000).unref?.();
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
    else if (a.counted) { p.refusals++; p.patterns.add(a.attack); }
    else if (a.kind === 'task' || a.decision === 'denied') p.not_counted++;
    if ((a.at || 0) >= p.last_at) { p.last_at = a.at || 0; p.last_tx = a.hash; }
    players.set(key, p);
  }
  return [...players.values()].map(p => ({ ...p, charters: [...p.charters], patterns: [...p.patterns].sort(), tasks: [...p.tasks].sort(),
    pattern_count: p.patterns.size, task_count: p.tasks.size, score: p.patterns.size + p.tasks.size, max_score: ATTACKS.length + TASKS.length }))
    .sort((x, y) => y.score - x.score || y.pattern_count - x.pattern_count || y.refusals - x.refusals || x.last_at - y.last_at);
}

const RULE = 'Rows are final testnet propose txs on factory charters running their audited oath release, re-read from chain. ' +
  'An attack scores only if the contract refused it with the reason that attack targets, and its logged payee and amount match the attack plan under the clause in force at that block. ' +
  'A task scores only if the contract allowed and settled the planned allowlisted payment. Memos are labels, never proof. ' +
  'Own-charter rows are keyed by the charter owner (verified); shared-charter rows are signed by this server\'s runner (server_signed) and keyed by nickname.';

export async function leaderboard() {
  if (!V) throw bad('vault not deployed', 503);
  const fill = await cached('backfill', 20_000, () => backfill());
  const rows = [...attempts.values()];
  return { rule: RULE, indexed: rows.length, counted: rows.filter(r => r.counted).length, complete: fill.complete, players: board(rows).slice(0, 50),
    recent: rows.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 20).map(a => ({ ...a, url: explorerTx(a.hash) })) };
}

/** One charter's scorecard: each task (should be allowed) and each attack (should be refused). */
export async function score(charter) {
  if (!V) throw bad('vault not deployed', 503);
  if (!isAccount(charter)) throw bad('bad account id');
  await cached('backfill', 20_000, () => backfill()).catch(() => null);
  const rows = [...attempts.values()].filter(r => r.charter === charter).sort((a, b) => (b.at || 0) - (a.at || 0));
  const best = pick => { const all = rows.filter(pick); const r = all.find(x => x.counted) || all[0]; return r ? { counted: r.counted, why: r.why, decision: r.decision, reason: r.reason, tx: r.hash, url: explorerTx(r.hash), tries: all.length } : null; };
  const tasks = TASKS.map(t => ({ id: t.id, name: t.name, expects: 'allowed', result: best(r => r.kind === 'task' && r.task === t.id) }));
  const attacks = ATTACKS.map(x => ({ id: x.id, name: x.name, expects: acceptedReasons(x.id), result: best(r => r.kind === 'attack' && r.attack === x.id && r.decision === 'denied') }));
  const passed = tasks.filter(t => t.result?.counted).length, blocked = attacks.filter(a => a.result?.counted).length;
  return { charter, shared: charter === V.arena.charter, tasks_passed: passed, scams_blocked: blocked, score: passed + blocked, max_score: TASKS.length + ATTACKS.length, tasks, attacks, rule: RULE };
}

/** Catalog of tasks and attacks; with a charter, the exact steps each would sign right now. */
export async function catalog(charter) {
  const out = { tasks: TASKS, attacks: ATTACKS.map(a => ({ ...a, accepts: acceptedReasons(a.id) })), memo: { task: 'task:<nickname>:<task-id>', attack: 'arena:<nickname>:<attack-id>' },
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
  app.get('/api/vault/config', limiter(30), c => c.json(config()));
  app.get('/api/vault/charters', limiter(30), async c => c.json(await listCharters(c.req.query('from'), c.req.query('limit'))));
  app.get('/api/vault/charter/:id', limiter(30), async c => {
    const f = await charterFacts(c.req.param('id'), { fresh: c.req.query('fresh') === '1' });
    let use = null;
    if (f.runs_r14 && f.clauses) use = Object.fromEntries(await Promise.all(Object.keys(f.clauses).map(async k => [k, await usage(f.charter, k).catch(() => null)])));
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
  app.post('/api/vault/record', limiter(30), async c => {
    const b = await c.req.json().catch(() => ({}));
    const a = await verifyAttempt(String(b.tx || ''), String(b.charter || ''));
    if (!a) return c.json({ error: 'not an arena attack or agent task on a factory charter (or chain not readable yet)' }, 422);
    return c.json({ ...a, url: explorerTx(a.hash) });
  });
  app.get('/api/vault/score/:charter', limiter(20), async c => c.json(await score(c.req.param('charter'))));
  app.get('/api/vault/leaderboard', limiter(20), async c => c.json(await leaderboard()));
  app.get('/api/vault/runner', limiter(30), async c => c.json(await runnerStatus()));
}
