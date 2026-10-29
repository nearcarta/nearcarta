// Payouts (C3): a payout list the charter pays as one all-or-nothing propose_batch (oath R16.1), or refuses whole.
// Pure helpers, no wallet or DOM, so backend/test/unit/d8-payouts.test.js can test them in node.
export const MAX_BATCH = 5; // contracts/oath MAX_BATCH
const TG_PER = 30, TG_BASE = 30, TG_MAX = 300; // oath needs >= 25 Tgas per native item (MIN_GAS_NATIVE)
export const batchGasTgas = n => Math.min(TG_MAX, TG_BASE + TG_PER * n);
const Y18 = 10n ** 18n;
export const toYocto = n => (BigInt(Math.round(Number(n) * 1e6)) * Y18).toString();

/** Validate the list and build the proposals. Throws with a short reason; never signs anything. */
export function planBatch(rows, { payees, nonce, policy, nowMs, ttlMs = 10 * 60_000, clauseId = 'pay', shop = 'payouts' }) {
  const list = (rows || []).filter(r => r && r.to);
  if (list.length < 2) throw new Error('add at least 2 payouts');
  if (list.length > MAX_BATCH) throw new Error(`at most ${MAX_BATCH} payouts in one batch`);
  for (const r of list) {
    if (!(Number(r.amt) > 0)) throw new Error('every payout needs an amount above 0');
    if (!payees.includes(r.to)) throw new Error('pay only accounts your rules allow');
  }
  const expires = (BigInt(nowMs + ttlMs) * 1_000_000n).toString(), n = list.length;
  const ps = list.map((r, i) => ({ shop, clause_id: clauseId, receiver: r.to, amount: toYocto(r.amt), nonce: String(BigInt(nonce) + BigInt(i)),
    policy_version: policy, expires_at: expires, memo: `payouts:${i + 1}/${n}`, receipt: null }));
  const total = list.reduce((s, r) => s + Math.round(Number(r.amt) * 1e6), 0) / 1e6;
  return { ps, total, n, gasTgas: batchGasTgas(n) };
}

/** Read the charter's answer: every item allowed, or every item denied (the bad item's reason, the rest "batch_refused"). */
export function readBatch(value, n) {
  const v = Array.isArray(value) ? value : [];
  if (v.length !== n) return { decision: 'failed', reason: 'unexpected answer', paid: 0, bad: null, ids: [] };
  if (v.every(o => o.decision === 'allowed')) return { decision: 'allowed', reason: 'ok', paid: n, bad: null, ids: v.map(o => o.action_id) };
  const bad = v.findIndex(o => o.reason !== 'batch_refused');
  return { decision: 'denied', reason: bad >= 0 ? v[bad].reason : 'batch_refused', paid: 0, bad: bad >= 0 && v.some(o => o.reason === 'batch_refused') ? bad : null, ids: [] };
}

/** What is left of today's budget, in NEAR (usage from get_usage: spent + reserved). */
export function leftToday(clause, usage) {
  if (!clause) return 0;
  const used = BigInt(usage?.spent || 0) + BigInt(usage?.reserved || 0), left = BigInt(clause.daily_budget) - used;
  return left > 0n ? Number(left / 10n ** 18n) / 1e6 : 0;
}
