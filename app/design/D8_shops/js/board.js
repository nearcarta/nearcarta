// Same string as shared/board/message.js. The shop page loads this file on its own;
// the unit test checks the two copies stay equal.
export function proposalMessage({ contract, owner, receiver, amount, nonce }) {
  return `board-v1|${contract}|${owner}|${receiver}|${amount}|${nonce}`;
}

export const REFUSALS = ['receiver_not_allowlisted', 'zero_amount', 'below_min_amount', 'outside_time_window', 'over_per_action_cap', 'over_daily_budget', 'over_daily_action_count', 'frozen', 'clause_expired', 'hidden_rule_receiver', 'hidden_rule_cap', 'ERR_BAD_SIG', 'ERR_BALANCE', 'ERR_SEAL'];

export function refusalOf(err) {
  const s = String(err?.message || err || '');
  return REFUSALS.find(r => s.includes(r)) || '';
}
