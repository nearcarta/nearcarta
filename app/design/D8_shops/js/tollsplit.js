// Toll revenue split (testnet): one visit is one all-or-nothing propose_batch the visitor's own charter checks.
// Leg 1 pays the gate's toll (0.01 NEAR to its payee, memo toll:base-sepolia) and opens the gate; legs 2 and 3
// pay the town treasury (the Town Hall DAO) and the Lamplighter's inference budget. Pure helpers, no wallet or DOM,
// so backend/test/unit/d8-tollsplit.test.js can test them in node.
import { toYocto, batchGasTgas } from './payouts.js';

export const SPLIT = {
  treasury: 'r7thmvr8maey.sputnikv2.testnet', // Town Hall DAO (sputnik v2)
  agent: 'lamp.ncpub-17102.testnet',          // the Lamplighter's inference budget
};
export const LEGS = [
  { role: 'owner', amt: 0.01, memo: 'toll:base-sepolia' },
  { role: 'treasury', amt: 0.002, memo: 'toll-split:treasury' },
  { role: 'agent', amt: 0.001, memo: 'toll-split:agent' },
];
export const SPLIT_TOTAL = 0.013;

/** Can this charter pay the split? It needs batches and all three payees allowed by its own rules. */
export const canSplit = (receivers, payee, batch) => !!batch && [payee, SPLIT.treasury, SPLIT.agent].every(a => (receivers || []).includes(a));

export function planSplit({ payee, nonce, policy, nowMs, ttlMs = 10 * 60_000, clauseId = 'pay' }) {
  if (!payee) throw new Error('no toll payee');
  const to = { owner: payee, treasury: SPLIT.treasury, agent: SPLIT.agent };
  const expires = (BigInt(nowMs + ttlMs) * 1_000_000n).toString();
  const ps = LEGS.map((l, i) => ({ shop: 'toll', clause_id: clauseId, receiver: to[l.role], amount: toYocto(l.amt), nonce: String(BigInt(nonce) + BigInt(i)),
    policy_version: policy, expires_at: expires, memo: l.memo, receipt: null }));
  return { ps, n: ps.length, total: SPLIT_TOTAL, gasTgas: batchGasTgas(ps.length), legs: LEGS.map(l => ({ ...l, to: to[l.role] })) };
}
