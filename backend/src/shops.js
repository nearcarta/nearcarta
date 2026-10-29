import { createHash } from 'node:crypto';
// Read-only live views for Town Hall, Arena and Toll, plus the Chronicle indexer.
import { DEP } from './config.js';
import { view, viewAccount, txStatus, eventsFromOutcome, txResult, explorerTx, rpc } from './near.js';
import { snapshot } from './guardhouse.js';
import { indexPost } from './txindex.js';

const yocto = s => (s == null ? null : Number(BigInt(s) * 10000n / 10n ** 24n) / 1e4);

export async function townhall() {
  // Town Hall is the R14 charter the DAO created through the charter factory: the DAO is owner and governor,
  // the agent holds a propose-only key, and there is no full-access key.
  const T = DEP.townhall;
  const [snap, policy, lastId] = await Promise.all([snapshot(T.charter), view(T.dao, 'get_policy'), view(T.dao, 'get_last_proposal_id')]);
  const proposals = await view(T.dao, 'get_proposals', { from_index: Math.max(0, lastId - 6), limit: 6 }).catch(() => []);
  const reward = snap.clauses?.[T.clause || 'reward'] || null;
  return {
    dao: T.dao, oath: T.charter, charter: T.charter, factory: T.factory, agent_key: snap.state.agent_key, keys: snap.keys,
    // oathState keeps the field names the console reads (version, frozen, policy.deny).
    oathState: { ...snap.state, version: snap.state.policy_version, policy: { deny: [] } },
    clauses: snap.clauses, usage: snap.usage,
    caps_near: { per_reward: yocto(reward?.per_action_cap), total: yocto(reward?.daily_budget), total_is: 'per UTC day' },
    receivers: reward?.receivers || [],
    bounties: [],
    council: policy.roles.filter(r => r.kind?.Group).map(r => ({ role: r.name, members: r.kind.Group })),
    proposals: proposals.map(p => ({ id: p.id, proposer: p.proposer, status: p.status, kind: Object.keys(p.kind)[0], description: String(p.description).slice(0, 160) })),
    lastProposalId: lastId, proof_txs: T.proof_txs,
    r16: await townhallR16(),
  };
}

// Town Hall on the R16.1 charter (propose_batch): pays a reward round in one all-or-nothing batch.
async function townhallR16() {
  const R = DEP.townhall_r16;
  if (!R) return null;
  try {
    const snap = await snapshot(R.charter);
    const reward = snap.clauses?.[R.clause || 'reward'] || null;
    return { charter: R.charter, release: R.release, owner: snap.state.owner, dao: snap.state.dao, agent_key: snap.state.agent_key, keys: snap.keys,
      frozen: snap.state.frozen, policy_version: snap.state.policy_version, next_action: snap.state.next_action,
      caps_near: { per_reward: yocto(reward?.per_action_cap), total: yocto(reward?.daily_budget), total_is: 'per UTC day' },
      receivers: reward?.receivers || [], usage: snap.usage, proof_txs: R.proof_txs };
  } catch { return null; }
}

export async function arena() {
  const A = DEP.arena.contract;
  const [season, guardian, acct] = await Promise.all([view(A, 'get_season'), view(A, 'get_guardian', { token_id: 'g1' }), viewAccount(A)]);
  const cases = ['case:C1_CAP', 'case:C3_ALLOWLIST', 'case:C6_BAD_PROOF', 'case:C7_HANDOFF', 'key:brass'];
  const supply = await view(A, 'mt_batch_supply', { token_ids: cases }).catch(() => []);
  const attempts = [];
  for (let i = 0; i < 12; i++) { const a = await view(A, 'get_attempt', { attempt_id: i }).catch(() => null); if (!a) break; attempts.push({ id: i, ...a }); }
  return { contract: A, season, guardian, balance_near: yocto(acct.amount), tokens: cases.map((t, i) => ({ token_id: t, supply: supply[i] })), attempts };
}

// The attack corpus, paged: every attempt is committed on chain by prompt hash, and anyone may reveal the prompt.
export async function arenaAttempts(from = 0, limit = 25) {
  const A = DEP.arena.contract;
  from = Math.max(0, Math.floor(Number(from) || 0)); limit = Math.min(25, Math.max(1, Math.floor(Number(limit) || 25)));
  const got = await Promise.all(Array.from({ length: limit }, (_, k) => view(A, 'get_attempt', { attempt_id: from + k }).catch(() => null)));
  const attempts = [];
  for (let k = 0; k < got.length && got[k]; k++) attempts.push({ id: from + k, ...got[k] });
  return { contract: A, from, attempts, next: attempts.length === limit ? from + limit : null,
    reveal: 'call reveal_prompt {attempt_id, prompt}; the contract checks sha256(prompt) against the commitment and emits a vaultarena "reveal" event' };
}

export async function toll() {
  const T = DEP.toll;
  const policy = await view(T.oath, 'policy');
  const recent = [];
  for (let n = Math.max(0, policy.next_nonce - 5); n < policy.next_nonce; n++) recent.push(await view(T.oath, 'get_tx', { nonce: n }).catch(() => null));
  const instances = (await Promise.all(TOLL_INSTANCES.map(tollInstance))).filter(Boolean);
  return { oath: T.oath, mpc: T.mpc, policy, recent: recent.filter(Boolean), foreign_explorer: `https://sepolia.basescan.org/address/${policy.foreign_address}`, instances };
}

// Further Toll instances from the deployments file: the Arbitrum Sepolia Toll and the USDC Toll (v3).
// Each is read from chain; one that cannot be read is left out rather than failing the route.
const EXPLORER = { Base: 'https://sepolia.basescan.org', Arbitrum: 'https://sepolia.arbiscan.io' };
const TOLL_INSTANCES = [['arbitrum', DEP.toll_arbitrum?.oath], ['usdc', DEP.toll_usdc?.toll]].filter(([, id]) => id);
async function tollInstance([label, id]) {
  try {
    const policy = await view(id, 'policy');
    const recent = [];
    for (let n = Math.max(0, policy.next_nonce - 3); n < policy.next_nonce; n++) recent.push(await view(id, 'get_tx', { nonce: n }).catch(() => null));
    const ex = EXPLORER[policy.verify_chain] || EXPLORER.Base;
    return { label, oath: id, chain_id: policy.chain_id, verify_chain: policy.verify_chain || 'Base', asset: policy.asset || 'native',
      policy, recent: recent.filter(Boolean), foreign_explorer: `${ex}/address/${policy.foreign_address}` };
  } catch { return null; }
}

// Chronicle: recent txs of a shop contract (FastNEAR tx index for the list), each re-read from NEAR RPC
// so events come from chain. Events from failed receipts are dropped (phantom events).
// The FastNEAR tx index rate-limits per IP (Render's egress is shared). Every call goes through one gate
// (txindex.js): deadlines, one shared 429 cooldown, and page feeds ('high') ahead of the board rebuild ('low').
// Still busy at the deadline -> an error without a status, so the route answers busy + Retry-After.
export async function fpost(path, body, f = fetch, waitMs = 700) {
  try { return await indexPost('/v0' + path, body, { prio: 'high', f, baseMs: waitMs }); }
  catch (e) { if (e.status) throw Object.assign(new Error(`fastnear ${e.message}`), { status: e.status }); throw new Error(`fastnear ${e.message}`); }
}
// Pages poll the feed after every tx: concurrent callers for one account+limit share one upstream read (1 s reuse),
// and the last good feed (marked stale) when the index is still busy after retries.
const feeds = new Map();
// Retired txs: the first Mist Bank payout's oath approval (its payee was retired when its viewing key was found in
// git history). Feeds leave it out so the site never re-links that payee; listed by sha256 so the hash itself is
// not repeated here. Chain explorers still show it, as they show every testnet tx.
export const RETIRED_TX_SHA256 = new Set(['ffbfd539498bf406654eb56d5dfb270fbda0f1620c833bc54789898e60cd2e7e']);
const sha256hex = s => createHash('sha256').update(String(s)).digest('hex');
export function hideRetired(feed) {
  if (!feed || !Array.isArray(feed.txs)) return feed;
  const txs = feed.txs.filter(t => !RETIRED_TX_SHA256.has(sha256hex(t.hash)));
  if (txs.length === feed.txs.length) return feed;
  return { ...feed, txs, count: txs.length, retired_hidden: feed.txs.length - txs.length };
}
export async function chronicle(account, limit = 8, read = chronicleOnce) {
  const k = account + '|' + limit, hit = feeds.get(k), now = Date.now();
  if (hit?.p) return hit.p;
  if (hit?.v && now - hit.at < 1_000) return hit.v;
  const p = read(account, limit).then(v => { feeds.set(k, { v, at: Date.now() }); return v; },
    e => { if (hit?.v) { feeds.set(k, hit); return { ...hit.v, stale: true }; } feeds.delete(k); throw e; });
  feeds.set(k, { ...hit, p });
  if (feeds.size > 500) feeds.delete(feeds.keys().next().value);
  return p;
}
async function chronicleOnce(account, limit = 8) {
  const { account_txs = [] } = await fpost('/account', { account_id: account, max_block_height: null });
  const list = account_txs.slice(0, limit);
  const { transactions = [] } = list.length ? await fpost('/transactions', { tx_hashes: list.map(t => t.transaction_hash) }) : {};
  const signer = Object.fromEntries(transactions.map(t => [t.transaction.hash, t.transaction.signer_id]));
  const out = [];
  for (const t of list) {
    try { out.push(txRow(await txStatus(t.transaction_hash, signer[t.transaction_hash] || account), new Date(Number(BigInt(t.tx_block_timestamp) / 1000000n)).toISOString())); }
    catch (e) { out.push({ hash: t.transaction_hash, error: e.message.slice(0, 120) }); }
  }
  return { account, count: out.length, source: 'tx.test.fastnear.com list + rpc EXPERIMENTAL_tx_status', txs: out };
}
function txRow(tx, at) {
  const h = tx.transaction.hash;
  const { events, dropped } = eventsFromOutcome(tx);
  return { hash: h, url: explorerTx(h), at, signer: tx.transaction.signer_id,
    method: tx.transaction.actions?.[0]?.FunctionCall?.method_name || Object.keys(tx.transaction.actions?.[0] || {})[0],
    result: txResult(tx), events: events.map(e => ({ standard: e.standard, event: e.event, data: e.data })), phantomDropped: dropped };
}
/** Does this tx belong to the account's feed: signed by it, sent to it, or the factory call that created it. */
export function txOf(tx, account) {
  const t = tx?.transaction;
  if (!t) return false;
  if (t.signer_id === account || t.receiver_id === account) return true;
  const fc = t.actions?.[0]?.FunctionCall;
  if (fc?.method_name !== 'create_charter') return false;
  try { return `${JSON.parse(Buffer.from(fc.args, 'base64').toString('utf8')).name}.${t.receiver_id}` === account; } catch { return false; }
}
/**
 * The feed without the index: given tx hashes (the page's own txs, or rows this server already verified), re-read
 * each from RPC and keep only those that belong to the account. Nothing is taken on trust from the caller.
 */
export async function chronicleFrom(account, hashes, limit = 8, { status = txStatus, blockAt = blockIso } = {}) {
  const rows = (await Promise.all([...new Set(hashes)].slice(0, 30).map(async h => {
    try { const tx = await status(h, account); return txOf(tx, account) ? txRow(tx, await blockAt(tx.transaction_outcome?.block_hash)) : null; }
    catch { return null; }
  }))).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { account, count: Math.min(rows.length, limit), source: 'known tx hashes + rpc EXPERIMENTAL_tx_status (tx index busy)', partial: true, txs: rows.slice(0, limit) };
}
async function blockIso(blockHash) {
  try { const b = await rpc('block', { block_id: blockHash }); return new Date(Number(BigInt(b.header.timestamp_nanosec) / 1000000n)).toISOString(); } catch { return null; }
}

export async function explainAny(hash, sender) {
  const tx = await txStatus(hash, sender);
  const { events, dropped } = eventsFromOutcome(tx);
  return { hash, url: explorerTx(hash), signer: tx.transaction.signer_id, receiver: tx.transaction.receiver_id, result: txResult(tx), events, phantomDropped: dropped };
}

// Render's health check hits /api/health, so an RPC 429 here must not fail it (that restarted the container
// in a loop). Serve the last good status marked stale, or an error field, and keep answering 200.
let lastStatus = null;
export async function health() {
  try {
    const s = await rpc('status', []);
    lastStatus = { chain_id: s.chain_id, height: s.sync_info.latest_block_height, time: s.sync_info.latest_block_time };
    return lastStatus;
  } catch (e) {
    const error = String(e.message).slice(0, 120);
    return lastStatus ? { ...lastStatus, stale: true, error } : { chain_id: null, height: null, error };
  }
}
