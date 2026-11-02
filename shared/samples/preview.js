// Offline preview of the charter's checks for the sample data. The contract on chain is the real
// judge; this mirror only lets someone see the expected verdicts without a wallet or real data.
const big = v => BigInt(v ?? 0);
export function preview(clause, { receiver, amount }, usage = { spent: '0', count: 0 }) {
  const a = big(amount);
  if (!clause.receivers.includes(receiver)) return 'receiver_not_allowlisted';
  if (a < big(clause.min_amount ?? '1')) return 'below_min_amount';
  if (a > big(clause.per_action_cap)) return 'over_per_action_cap';
  if (big(usage.spent) + a > big(clause.daily_budget)) return 'over_daily_budget';
  if (clause.max_actions_per_day && Number(usage.count) + 1 > clause.max_actions_per_day) return 'over_daily_action_count';
  return 'allowed';
}
