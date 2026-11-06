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
export const oathId = G?.oath || MAINNET_DEP?.charter?.contract || null;

export async function snapshot(oath = oathId) {
  if (!oath) throw Object.assign(new Error('no oath on this network'), { status: 503 });
  if (RETIRED.has(oath)) {
    throw Object.assign(new Error(`${oath} is retired; its NEAR returned to ${MAINNET_DEP?.retired?.[oath]?.recovered_to || 'the owner'}`), { status: 404 });
  }
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

// ---- the live guard charter is the board ----
// charter.nearcarta.near is reaped (mainnet.json `retired`). The charter a visitor
// actually has is their row on board.nearcarta.near, so /api/guardhouse reads that:
// the board config, a row when ?owner= names one, and the live policy of that row.
// It answers 200 with `retired_legacy` naming the old oath instead of a bare 404,
// so a dashboard that reads this route gets a real payload and does not fall back.
export const BOARD = MAINNET_DEP?.board?.contract || null;

export async function boardSnapshot({ owner = null } = {}) {
  if (!BOARD) throw Object.assign(new Error('no board on this network'), { status: 503 });
  const [config, liabilities] = await Promise.all([
    view(BOARD, 'get_config').catch(() => null),
    view(BOARD, 'get_liabilities').catch(() => null),
  ]);
  const want = typeof owner === 'string' && /^[a-z0-9][a-z0-9._-]{0,62}\.near$/.test(owner) ? owner : null;
  const row = want ? await view(BOARD, 'get_charter', { owner: want }).catch(() => null) : null;
  return {
    oath: BOARD,
    board: BOARD,
    network: 'mainnet',
    retired_legacy: [...RETIRED][0] || null,
    retired_note: [...RETIRED].length
      ? `${[...RETIRED][0]} is retired; its NEAR returned to ${MAINNET_DEP?.retired?.[[...RETIRED][0]]?.recovered_to || 'the owner'}. The live guard charter is the visitor row on ${BOARD}.`
      : null,
    config: config ? { owner: config.owner, rows: Number(config.rows), max_row_yocto: String(config.max_row_yocto), byte_yocto: String(config.byte_yocto) } : null,
    liabilities: liabilities == null ? null : String(liabilities),
    owner: want,
    row: row ? {
      owner: row.owner,
      per_action_cap: String(row.per_action_cap),
      daily_budget: String(row.daily_budget),
      max_actions_per_day: Number(row.max_actions_per_day),
      min_amount: String(row.min_amount),
      expires_at: String(row.expires_at),
      frozen: row.frozen === true,
      sealed: row.sealed === true,
      agent: row.agent,
      nonce: String(row.nonce),
      balance: String(row.balance),
      storage_locked: String(row.storage_locked),
      receivers: Array.isArray(row.receivers) ? row.receivers : [],
      spent_today: String(row.spent_today),
      actions_today: Number(row.actions_today),
    } : null,
    has_row: !!row,
    src: 'mainnet',
    snapshot: new Date().toISOString(),
  };
}


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
