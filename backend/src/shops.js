import { createHash } from 'node:crypto';
// Read-only live views for Town Hall, Arena and Toll, plus the Chronicle indexer.
import { DEP } from './config.js';
import { view, viewAccount, txStatus, eventsFromOutcome, txResult, explorerTx, rpc } from './near.js';
import { snapshot } from './guardhouse.js';
import { indexPost } from './txindex.js';
import { proposalState } from '../../shared/townhall/expiry.js';
import { signedState } from '../../shared/stale.js';

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
    // status is Expired once the vote window closed (Sputnik keeps InProgress until act_proposal); chain_status is raw.
    proposals: proposals.map(p => townhallProposal(p, policy.proposal_period)),
    proposal_period_h: Number(BigInt(policy.proposal_period) / 10n ** 9n) / 3600,
    lastProposalId: lastId, proof_txs: T.proof_txs,
    r16: await townhallR16(),
  };
}

export function townhallProposal(p, periodNs, nowMs = Date.now()) {
  const s = proposalState(p, periodNs, nowMs);
  return { id: p.id, proposer: p.proposer, status: s.status, chain_status: s.chain_status, expired: s.expired,
    ends_at: s.ends_at_ms == null ? null : new Date(s.ends_at_ms).toISOString(),
    kind: typeof p.kind === 'string' ? p.kind : Object.keys(p.kind)[0], description: String(p.description).slice(0, 160) };
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
  return { oath: T.oath, mpc: T.mpc, policy, recent: await sweepRecent(recent.filter(Boolean), policy), foreign_explorer: `https://sepolia.basescan.org/address/${policy.foreign_address}`, instances };
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
      policy, recent: await sweepRecent(recent.filter(Boolean), policy), foreign_explorer: `${ex}/address/${policy.foreign_address}` };
  } catch { return null; }
}

// Stale-record sweep: a record still "signed" on NEAR is checked against its foreign chain and shown as
// pending, settling or expired (shared/stale.js). chain_status keeps the contract's own word.
const EVM_RPC = { Base: process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org', Arbitrum: process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc' };
export async function evmFacts(chain, rec, from, f = fetch) {
  const call = async (method, params) => { const r = await f(EVM_RPC[chain] || EVM_RPC.Base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(6000) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; };
  const [tx, rcpt, nonce, bal] = await Promise.all([call('eth_getTransactionByHash', [rec.tx_hash]), call('eth_getTransactionReceipt', [rec.tx_hash]),
    from ? call('eth_getTransactionCount', [from, 'latest']) : null, from ? call('eth_getBalance', [from, 'latest']) : null]);
  return { known: !!tx, mined: !!rcpt, sender_nonce: nonce == null ? null : Number(BigInt(nonce)), balance_wei: bal == null ? null : BigInt(bal).toString() };
}
export async function sweepRecent(recent, policy, facts = evmFacts) {
  return Promise.all(recent.map(async r => {
    if (r.status !== 'signed') return r;
    const st = signedState(r, await facts(policy.verify_chain || 'Base', r, policy.foreign_address).catch(() => null));
    return { ...r, chain_status: 'signed', status: st.state, stale_reason: st.reason };
  }));
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
// Feed cache (stale-while-revalidate). One read per account at FEED_MAX rows serves every limit (a slice), so the
// HUD (3), the console (8) and the room (12) share it. Fresh for FEED_TTL_MS; after that, up to FEED_STALE_MS old, the
// cached feed is answered at once (marked stale) and one background read refreshes it. Older than that, or nothing
// cached, the caller waits for the read. Concurrent callers share one in-flight read. A failed read keeps the last good
// feed; with nothing cached the error goes to the route (busy + Retry-After). Pages that just sent a tx pass their own
// hashes (?known=), which the route merges from RPC, so a cached feed never hides a visitor's newest tx.
export const FEED_MAX = 15, FEED_TTL_MS = 15_000, FEED_STALE_MS = 10 * 60_000, FEED_COLD_WAIT_MS = Number(process.env.FEED_COLD_WAIT_MS || 8000);
const feeds = new Map(); // account -> { v, at, p }
export const _resetFeeds = () => feeds.clear();
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
const sliceFeed = (v, limit, extra) => { const txs = (v.txs || []).slice(0, limit); return { ...v, ...extra, count: txs.length, txs }; };
function refresh(account, read) {
  const hit = feeds.get(account);
  if (hit?.p) return hit.p;
  const p = read(account, FEED_MAX).then(v => { feeds.set(account, { v, at: Date.now() }); return v; },
    e => { const h = feeds.get(account); if (h?.v) feeds.set(account, { v: h.v, at: h.at }); else feeds.delete(account); throw e; });
  feeds.set(account, { ...hit, p });
  if (feeds.size > 500) feeds.delete(feeds.keys().next().value);
  return p;
}
export async function chronicle(account, limit = 8, read = chronicleOnce, now = Date.now(), coldWait = FEED_COLD_WAIT_MS) {
  const n = Math.max(1, Math.min(Number(limit) || 8, FEED_MAX)), hit = feeds.get(account);
  if (hit?.v) {
    const age = now - hit.at;
    if (age < FEED_TTL_MS) return sliceFeed(hit.v, n);
    if (age < FEED_STALE_MS) { refresh(account, read).catch(() => {}); return sliceFeed(hit.v, n, { stale: true, stale_age_s: Math.round(age / 1000) }); }
  }
  // A cold read re-checks up to FEED_MAX txs on RPC and took ~58 s after an idle spell. Wait at most FEED_COLD_WAIT_MS;
  // past that the route answers "busy, retry" (or the old feed, stale) and the read keeps going and fills the cache.
  try {
    const p = refresh(account, read); let timer;
    const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout: feed still loading')), coldWait); timer.unref?.(); });
    p.catch(() => {});
    try { return sliceFeed(await Promise.race([p, late]), n); } finally { clearTimeout(timer); }
  }
  catch (e) { if (hit?.v) return sliceFeed(hit.v, n, { stale: true, stale_age_s: Math.round((now - hit.at) / 1000) }); throw e; }
}
// Re-read each listed tx from RPC in parallel (bounded), keeping the index order.
async function inParallel(items, conc, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
export async function chronicleOnce(account, limit = FEED_MAX, { post = fpost, status = txStatus } = {}) {
  const { account_txs = [] } = await post('/account', { account_id: account, max_block_height: null });
  const list = account_txs.slice(0, limit);
  const { transactions = [] } = list.length ? await post('/transactions', { tx_hashes: list.map(t => t.transaction_hash) }) : {};
  const signer = Object.fromEntries(transactions.map(t => [t.transaction.hash, t.transaction.signer_id]));
  const out = await inParallel(list, 6, async t => {
    try { return txRow(await status(t.transaction_hash, signer[t.transaction_hash] || account), new Date(Number(BigInt(t.tx_block_timestamp) / 1000000n)).toISOString()); }
    catch (e) { return { hash: t.transaction_hash, error: e.message.slice(0, 120) }; }
  });
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
    // A slow RPC after idle must not make the health check slow: answer the last good status after 1.5 s
    // and let the call finish in the background.
    const live = rpc('status', []).then(s => (lastStatus = { chain_id: s.chain_id, height: s.sync_info.latest_block_height, time: s.sync_info.latest_block_time }));
    if (!lastStatus) return await live;
    live.catch(() => {});
    return await Promise.race([live, new Promise(r => setTimeout(() => r({ ...lastStatus, stale: true }), 1500).unref?.())]);
  } catch (e) {
    const error = String(e.message).slice(0, 120);
    return lastStatus ? { ...lastStatus, stale: true, error } : { chain_id: null, height: null, error };
  }
}
