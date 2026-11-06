// Guardhouse: the agent's oath contract. Every spend is a propose() that the contract itself checks
// (clause, receiver allowlist, cap, daily budget, nonce, policy version, expiry, optional TEE receipt).
// The agent key is a function-call key that can only call propose on the oath account.
import { readFileSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
import { DEP, MAINNET_DEP, cfg } from './config.js';
import { view, txStatus, eventsFromOutcome, txResult, explorerTx, accessKeys } from './near.js';

const G = DEP.guardhouse || null;
// charter.nearcarta.near was retired to nearcarta.near (recorded in mainnet.json `retired`).
// A snapshot of a deleted account is not a server fault, so this answers a plain 404 instead of 500.
const RETIRED = new Set(Object.entries(MAINNET_DEP?.retired || {})
  .filter(([, v]) => v?.status === 'deleted')
  .map(([id]) => id));
// The visitor board replaced the oath: a row per account on board.nearcarta.near.
export const boardId = MAINNET_DEP?.board?.contract || null;
export const oathId = G?.oath || (MAINNET_DEP?.charter?.contract && !RETIRED.has(MAINNET_DEP.charter.contract) ? MAINNET_DEP.charter.contract : null) || boardId;

/**
 * The board is the oath now. It has no `get_state`/`get_clauses`: the rules live in each
 * visitor's row, and `get_config` is the only whole-contract read. Return the same shape
 * the old oath snapshot had, so the dashboards keep working with the live source.
 *
 * `opts.owner` adds that visitor's row (the live policy: caps, receivers, nonce, frozen),
 * and `retired_legacy` names the reaped oath so a reader can see what happened to it instead
 * of getting a bare 404.
 */
export async function boardSnapshot(board, { owner = null } = {}) {
  const [config, keys, liabilities] = await Promise.all([
    view(board, 'get_config'), accessKeys(board),
    view(board, 'get_liabilities').catch(() => null),
  ]);
  const fullAccess = keys.keys.filter(k => k.access_key.permission === 'FullAccess').length;
  const fc = keys.keys.filter(k => k.access_key.permission !== 'FullAccess').map(k => ({
    public_key: k.public_key, receiver: k.access_key.permission.FunctionCall.receiver_id, methods: k.access_key.permission.FunctionCall.method_names }));
  const want = typeof owner === 'string' && /^[a-z0-9][a-z0-9._-]{0,62}\.near$/.test(owner) ? owner : null;
  const row = want ? await view(board, 'get_charter', { owner: want }).catch(() => null) : null;
  const legacy = [...RETIRED][0] || null;
  return {
    board,
    oath: board,
    state: {
      owner: config.owner, dao: null, frozen: row?.frozen === true,
      policy_version: 2, policy_hash: null, freeze_epoch: 0, agent_key: row?.agent ?? null,
      rows: config.rows, max_row_yocto: config.max_row_yocto,
    },
    config: { owner: config.owner, rows: Number(config.rows), max_row_yocto: String(config.max_row_yocto), byte_yocto: String(config.byte_yocto) },
    liabilities: liabilities == null ? null : String(liabilities),
    retired_legacy: legacy,
    retired_note: legacy
      ? `${legacy} is retired; its NEAR returned to ${MAINNET_DEP?.retired?.[legacy]?.recovered_to || 'the owner'}. The live guard charter is the visitor row on ${board}.`
      : null,
    owner: want,
    has_row: !!row,
    row: row ? {
      owner: row.owner,
      per_action_cap: String(row.per_action_cap), daily_budget: String(row.daily_budget),
      max_actions_per_day: Number(row.max_actions_per_day), min_amount: String(row.min_amount),
      expires_at: String(row.expires_at), frozen: row.frozen === true, sealed: row.sealed === true,
      agent: row.agent, nonce: String(row.nonce), balance: String(row.balance),
      storage_locked: String(row.storage_locked),
      receivers: Array.isArray(row.receivers) ? row.receivers : [],
      spent_today: String(row.spent_today), actions_today: Number(row.actions_today),
    } : null,
    clauses: null,
    usage: {},
    keys: { fullAccess, functionCall: fc },
    source: 'board',
  };
}

export async function snapshot(oath = oathId) {
  if (!oath) throw Object.assign(new Error('no oath on this network'), { status: 503 });
  if (RETIRED.has(oath)) {
    throw Object.assign(new Error(`${oath} is retired; its NEAR returned to ${MAINNET_DEP?.retired?.[oath]?.recovered_to || 'the owner'}`), { status: 404 });
  }
  if (boardId && oath === boardId) return boardSnapshot(oath);
  const oathId = oath;
  const [state, clauses, keys] = await Promise.all([view(oathId, 'get_state'), view(oathId, 'get_clauses'), accessKeys(oathId)]);
  const usage = {};
  for (const id of Object.keys(clauses || {})) usage[id] = await view(oathId, 'get_usage', { clause_id: id }).catch(() => null);
  const fullAccess = keys.keys.filter(k => k.access_key.permission === 'FullAccess').length;
  const fc = keys.keys.filter(k => k.access_key.permission !== 'FullAccess').map(k => ({
    public_key: k.public_key, receiver: k.access_key.permission.FunctionCall.receiver_id, methods: k.access_key.permission.FunctionCall.method_names }));
  return { oath: oathId, state, clauses, usage, keys: { fullAccess, functionCall: fc } };
}

export const action = (id, oath = oathId) => view(oath, 'get_action', { action_id: id });

export async function proposal({ clause_id, receiver, amount, memo = null, shop = 'guardhouse', ttlSec = 3600 }, oath = oathId) {
  const s = await view(oath, 'get_state');
  return { shop, clause_id, receiver, amount: String(amount), nonce: s.next_nonce, policy_version: s.policy_version,
    expires_at: String(BigInt(Date.now()) * 1000000n + BigInt(ttlSec) * 1000000000n), memo, receipt: null };
}

// Signing is for local scripts and integration tests only: the deployed API never holds the agent key.
export function agentFromFile(path) {
  const k = JSON.parse(readFileSync(path, 'utf8'));
  const provider = new JsonRpcProvider({ url: cfg.rpc });
  return new Account(k.account_id, provider, KeyPairSigner.fromSecretKey(k.private_key));
}

export async function propose(account, p, { gasTgas = 150, oath = oathId } = {}) {
  const out = await account.signAndSendTransaction({
    receiverId: oath,
    actions: [(await import('near-api-js')).actions.functionCall('propose', { p }, BigInt(gasTgas) * 10n ** 12n, 0n)],
    waitUntil: 'FINAL',
  });
  return explain(out.transaction.hash, oath);
}

// Read any oath tx back from chain: verdict, events (phantoms dropped) and link.
export async function explain(hash, sender = oathId) {
  const tx = await txStatus(hash, sender);
  const { events, dropped } = eventsFromOutcome(tx);
  const verdicts = events.filter(e => e.standard === 'oath' || e.standard?.startsWith('oath'));
  return { hash, url: explorerTx(hash), result: txResult(tx), events: verdicts.length ? verdicts : events, phantomEventsDropped: dropped,
    gas_tgas: +([tx.transaction_outcome, ...tx.receipts_outcome].reduce((s, o) => s + o.outcome.gas_burnt, 0) / 1e12).toFixed(2) };
}
