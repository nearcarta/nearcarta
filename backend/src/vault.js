// Charters and Vault Arena. Charters come from the factory on chain; every arena result is a
// final testnet tx, and the leaderboard is rebuilt from chain (factory list + each charter's
// propose txs, each one re-verified through RPC).
//
// Exception to "no route can sign": POST /api/vault/attack signs `propose` on the SHARED arena
// charter with ARENA_AGENT_KEY. That key is a function-call key that can only call `propose` on
// that one charter, with a gas allowance; the charter's own clause (allowlist, small caps, daily
// budget) bounds what an allowed step can move. The key is read lazily and never logged or returned.
import { DEP, cfg } from './config.js';
import { rpc, view, viewAccount, accessKeys, txStatus, eventsFromOutcome, explorerTx } from './near.js';
import { ATTACKS, ATTACK_IDS, MEMO_RE } from '../../shared/vault/attacks.js';
import { keyFrom, sendPropose, rpcClient } from '../../shared/vault/tx.js';
import { runSteps } from '../../shared/vault/run.js';

export const V = DEP.vault || null;
const ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const isAccount = a => typeof a === 'string' && ACCOUNT_RE.test(a);

export function config() {
  if (!V) throw bad('vault not deployed on this network', 503);
  return { network: DEP.network, factory: V.factory, code_hash: V.code_hash, factory_sha256: V.factory_sha256,
    min_deposit: V.min_deposit, arena: { charter: V.arena.charter, merchants: V.arena.merchants, owner: V.arena.owner },
    attacks: ATTACKS, explorer: DEP.explorer, rpc: cfg.rpc, proof_txs: V.proof_txs, attack_enabled: !!agentSecret() };
}

// ---------- charter facts (cached briefly; all from chain) ----------
const cache = new Map();
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ms) return hit.v;
  const v = await fn(); cache.set(key, { t: Date.now(), v }); if (cache.size > 5000) cache.clear(); return v;
}
export const _clearCache = () => cache.clear();

export async function charterFacts(id, { fresh = false } = {}) {
  if (!V) throw bad('vault not deployed', 503);
  if (!isAccount(id)) throw bad('bad account id');
  if (fresh) cache.delete('facts:' + id);
  const f = await cached('facts:' + id, 15_000, async () => {
    const reg = await view(V.factory, 'get_charter', { account_id: id });
    let acct = null;
    try { acct = await viewAccount(id); } catch { /* missing account */ }
    if (!acct) return { charter: id, exists: false, registered: !!reg };
    const keys = (await accessKeys(id)).keys || [];
    const full = keys.filter(k => k.access_key.permission === 'FullAccess').length;
    const agentKeys = keys.filter(k => k.access_key.permission?.FunctionCall).map(k => ({ public_key: k.public_key,
      methods: k.access_key.permission.FunctionCall.method_names, receiver: k.access_key.permission.FunctionCall.receiver_id,
      allowance: k.access_key.permission.FunctionCall.allowance }));
    const runsR14 = acct.global_contract_hash === V.code_hash;
    let state = null, clauses = null;
    // Right after create_charter, RPC nodes can lag behind each other: the account is there before its state.
    let pending = false;
    if (runsR14) { try { state = await view(id, 'get_state'); clauses = await view(id, 'get_clauses'); } catch { pending = true; } }
    return { charter: id, exists: true, registered: !!reg, owner: reg?.owner ?? state?.owner ?? null, created_at: reg?.created_at ?? null,
      code_hash: acct.global_contract_hash || acct.code_hash, runs_r14: runsR14, full_access_keys: full, agent_keys: agentKeys,
      balance: acct.amount, state, clauses, verified: !!reg && runsR14 && full === 0, ...(pending ? { pending: true } : {}) };
  });
  if (!f.exists || f.pending) cache.delete('facts:' + id); // never cache a half-visible charter
  return f;
}

export async function usage(id, clauseId) { return view(id, 'get_usage', { clause_id: clauseId }); }

export async function listCharters(from = 0, limit = 50) {
  if (!V) throw bad('vault not deployed', 503);
  const f = Math.max(0, Number(from) || 0), l = Math.min(100, Math.max(1, Number(limit) || 50));
  return cached(`list:${f}:${l}`, 10_000, async () => {
    const [config, rows] = await Promise.all([view(V.factory, 'get_config'), view(V.factory, 'list', { from_index: f, limit: l })]);
    return { factory: V.factory, count: config.count, code_hash: config.code_hash,
      charters: rows.map(([charter, c]) => ({ charter, owner: c.owner, created_at: c.created_at, index: c.index, shared: charter === V.arena.charter })) };
  });
}

// ---------- the shared arena runner ----------
function agentSecret() { return (process.env.ARENA_AGENT_KEY || '').trim() || null; }
let queue = Promise.resolve();
const serial = fn => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

/** Run one attack on a charter with a key that may call `propose` on it. Stops at the first refusal. */
export async function runAttack({ charter, key, attackId, tag, rpcCall = rpcClient(cfg.rpc), viewF = view, send = sendPropose }) {
  const result = await runSteps({ charter, key, attackId, tag, rpcCall, viewF, send });
  for (const st of result.steps) st.url = explorerTx(st.tx);
  const last = result.steps[result.steps.length - 1];
  if (result.refused) remember({ hash: last.tx, charter, attack: attackId, tag, decision: 'denied', reason: last.reason, at: Date.now() });
  return result;
}

export async function sharedAttack(attackId, tag) {
  if (!V) throw bad('vault not deployed', 503);
  const secret = agentSecret();
  if (!secret) throw bad('shared arena runner is off on this deployment (no agent key set)', 503);
  return serial(() => runAttack({ charter: V.arena.charter, key: keyFrom(secret), attackId, tag }));
}

// ---------- leaderboard (verified from chain) ----------
const attempts = new Map(); // tx hash -> verified attempt
function remember(a) { if (attempts.size > 50_000) attempts.clear(); attempts.set(a.hash, a); }
export const _attempts = attempts;

/** Verify one tx is an arena attempt on a factory charter running the audited oath code (R14). */
async function blockTimeMs(blockHash) {
  try { const b = await rpc('block', { block_id: blockHash }); return Math.floor(Number(BigInt(b.header.timestamp_nanosec) / 1_000_000n)); } catch { return null; }
}

export async function verifyAttempt(hash, charter, { status = txStatus, facts = charterFacts, blockTime = blockTimeMs } = {}) {
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
  const m = MEMO_RE.exec(p?.memo || '');
  if (!m || !ATTACK_IDS.includes(m[2])) return null;
  const ev = eventsFromOutcome(tx).events.find(e => e.standard === 'oath' && e.event === 'action' && e.executor === charter);
  if (!ev) return null;
  const d = ev.data?.[0] || {};
  const a = { hash, charter, owner: f.owner, attack: m[2], tag: m[1], decision: d.decision, reason: d.reason || null,
    shared: charter === V.arena.charter, at: null };
  const bh = tx.transaction_outcome?.block_hash;
  if (bh) a.at = await blockTime(bh);
  remember(a);
  return a;
}

const FASTNEAR_TX = process.env.FASTNEAR_TX_API || 'https://tx.test.fastnear.com';
async function charterTxs(charter) {
  const r = await fetch(`${FASTNEAR_TX}/v0/account`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account_id: charter, is_signer: true, limit: 200 }) });
  if (!r.ok) throw new Error('tx index http ' + r.status);
  const j = await r.json();
  return (j.account_txs || []).filter(x => x.is_signer && x.is_receiver && x.is_function_call)
    .map(x => ({ hash: x.transaction_hash, at: Math.floor(Number(BigInt(x.tx_block_timestamp) / 1_000_000n)) }));
}

/** Pull each charter's propose txs from the index, verify the new ones on RPC (bounded per call). */
export async function backfill({ budget = 40 } = {}) {
  const { charters } = await listCharters(0, 100);
  let checked = 0;
  for (const c of charters) {
    let txs = [];
    try { txs = await cached('txs:' + c.charter, 30_000, () => charterTxs(c.charter)); } catch { continue; }
    for (const t of txs) {
      if (attempts.has(t.hash)) { const a = attempts.get(t.hash); if (a && !a.at) a.at = t.at; continue; }
      if (checked >= budget) return { checked, complete: false };
      checked++;
      try { const a = await verifyAttempt(t.hash, c.charter); if (a) a.at = t.at; else attempts.set(t.hash, null); } catch { /* retry next time */ }
    }
  }
  return { checked, complete: true };
}

export function board(list = [...attempts.values()].filter(Boolean)) {
  const players = new Map();
  for (const a of list) {
    const key = a.shared ? `nick:${a.tag}` : `owner:${a.owner}`;
    const p = players.get(key) || { player: a.shared ? a.tag : a.owner, verified: !a.shared, charters: new Set(), patterns: new Set(), refusals: 0, attempts: 0, last_tx: null, last_at: 0 };
    p.attempts++; p.charters.add(a.charter);
    if (a.decision === 'denied') { p.refusals++; p.patterns.add(a.attack); }
    if ((a.at || 0) >= p.last_at) { p.last_at = a.at || 0; p.last_tx = a.hash; }
    players.set(key, p);
  }
  return [...players.values()].map(p => ({ ...p, charters: [...p.charters], patterns: [...p.patterns].sort(), pattern_count: p.patterns.size }))
    .sort((x, y) => y.pattern_count - x.pattern_count || y.refusals - x.refusals || x.last_at - y.last_at);
}

export async function leaderboard() {
  if (!V) throw bad('vault not deployed', 503);
  const fill = await cached('backfill', 20_000, () => backfill());
  const rows = [...attempts.values()].filter(Boolean);
  return { rule: 'Each row counts final testnet propose txs on factory charters running the audited oath code (R14), memo arena:<tag>:<attack>, re-verified via RPC. Own-charter rows are keyed by the charter owner (verified); shared-charter rows by nickname (not verified).',
    indexed: rows.length, complete: fill.complete, players: board(rows).slice(0, 50),
    recent: rows.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 20).map(a => ({ ...a, url: explorerTx(a.hash) })) };
}

export function register(app, { limiter, globalCap }) {
  app.get('/api/vault/config', limiter(30), c => c.json(config()));
  app.get('/api/vault/charters', limiter(30), async c => c.json(await listCharters(c.req.query('from'), c.req.query('limit'))));
  app.get('/api/vault/charter/:id', limiter(30), async c => {
    const f = await charterFacts(c.req.param('id'), { fresh: c.req.query('fresh') === '1' });
    let use = null;
    if (f.runs_r14 && f.clauses) use = Object.fromEntries(await Promise.all(Object.keys(f.clauses).map(async k => [k, await usage(f.charter, k).catch(() => null)])));
    return c.json({ ...f, usage: use });
  });
  app.post('/api/vault/attack', limiter(6), globalCap('vault-attack', 30), async c => {
    const b = await c.req.json().catch(() => ({}));
    return c.json(await sharedAttack(String(b.attack || ''), String(b.nickname || '').toLowerCase()));
  });
  app.post('/api/vault/record', limiter(30), async c => {
    const b = await c.req.json().catch(() => ({}));
    const a = await verifyAttempt(String(b.tx || ''), String(b.charter || ''));
    if (!a) return c.json({ error: 'not an arena attempt on a factory charter' }, 422);
    return c.json({ ...a, url: explorerTx(a.hash) });
  });
  app.get('/api/vault/leaderboard', limiter(20), async c => c.json(await leaderboard()));
}
