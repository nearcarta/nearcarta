// Read-only live views for Town Hall, Arena and Toll, plus the Chronicle indexer.
import { DEP } from './config.js';
import { view, viewAccount, txStatus, eventsFromOutcome, txResult, explorerTx, rpc } from './near.js';

const yocto = s => (s == null ? null : Number(BigInt(s) * 10000n / 10n ** 24n) / 1e4);

export async function townhall() {
  const T = DEP.townhall;
  const [oath, bounties, policy, lastId] = await Promise.all([
    view(T.oath, 'get_state'), view(T.oath, 'get_bounties'), view(T.dao, 'get_policy'), view(T.dao, 'get_last_proposal_id')]);
  const proposals = await view(T.dao, 'get_proposals', { from_index: Math.max(0, lastId - 6), limit: 6 }).catch(() => []);
  return {
    dao: T.dao, oath: T.oath, agent: T.agent, oathState: oath,
    caps_near: { per_reward: yocto(oath.policy?.per_reward_cap), total: yocto(oath.policy?.total_cap) },
    bounties: bounties.map(([hash, b]) => ({ hash, amount_near: yocto(b.amount), claimed_by: b.claimed_by, policy_version: b.policy_version })),
    council: policy.roles.filter(r => r.kind?.Group).map(r => ({ role: r.name, members: r.kind.Group })),
    proposals: proposals.map(p => ({ id: p.id, proposer: p.proposer, status: p.status, kind: Object.keys(p.kind)[0], description: String(p.description).slice(0, 160) })),
    lastProposalId: lastId,
  };
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

export async function toll() {
  const T = DEP.toll;
  const policy = await view(T.oath, 'policy');
  const recent = [];
  for (let n = Math.max(0, policy.next_nonce - 5); n < policy.next_nonce; n++) recent.push(await view(T.oath, 'get_tx', { nonce: n }).catch(() => null));
  return { oath: T.oath, mpc: T.mpc, policy, recent: recent.filter(Boolean), foreign_explorer: `https://sepolia.basescan.org/address/${policy.foreign_address}` };
}

// Chronicle: recent txs of a shop contract (FastNEAR tx index for the list), each re-read from NEAR RPC
// so events come from chain. Events from failed receipts are dropped (phantom events).
const FASTNEAR_TX = 'https://tx.test.fastnear.com/v0';
async function fpost(path, body) {
  const r = await fetch(`${FASTNEAR_TX}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw Object.assign(new Error(`fastnear tx http ${r.status}`), { status: 502 });
  return r.json();
}
export async function chronicle(account, limit = 8) {
  const { account_txs = [] } = await fpost('/account', { account_id: account, max_block_height: null });
  const list = account_txs.slice(0, limit);
  const { transactions = [] } = list.length ? await fpost('/transactions', { tx_hashes: list.map(t => t.transaction_hash) }) : {};
  const signer = Object.fromEntries(transactions.map(t => [t.transaction.hash, t.transaction.signer_id]));
  const out = [];
  for (const t of list) {
    try {
      const tx = await txStatus(t.transaction_hash, signer[t.transaction_hash] || account);
      const { events, dropped } = eventsFromOutcome(tx);
      out.push({ hash: t.transaction_hash, url: explorerTx(t.transaction_hash), at: new Date(Number(BigInt(t.tx_block_timestamp) / 1000000n)).toISOString(),
        signer: tx.transaction.signer_id, method: tx.transaction.actions?.[0]?.FunctionCall?.method_name || Object.keys(tx.transaction.actions?.[0] || {})[0],
        result: txResult(tx), events: events.map(e => ({ standard: e.standard, event: e.event, data: e.data })), phantomDropped: dropped });
    } catch (e) { out.push({ hash: t.transaction_hash, error: e.message.slice(0, 120) }); }
  }
  return { account, count: out.length, source: 'tx.test.fastnear.com list + rpc EXPERIMENTAL_tx_status', txs: out };
}

export async function explainAny(hash, sender) {
  const tx = await txStatus(hash, sender);
  const { events, dropped } = eventsFromOutcome(tx);
  return { hash, url: explorerTx(hash), signer: tx.transaction.signer_id, receiver: tx.transaction.receiver_id, result: txResult(tx), events, phantomDropped: dropped };
}

export async function health() {
  const s = await rpc('status', []);
  return { chain_id: s.chain_id, height: s.sync_info.latest_block_height, time: s.sync_info.latest_block_time };
}
