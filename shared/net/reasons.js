// Human labels for charter refusal codes. The code stays on chain; the page shows the sentence.
export const REASONS = {
  receiver_not_allowlisted: 'Refused: payee not on your list',
  hidden_rule_receiver: 'Refused: payee is on your sealed deny list',
  over_per_action_cap: 'Refused: over the per-payment cap',
  over_daily_budget: 'Refused: over the daily budget',
  over_daily_action_count: 'Refused: no payments left today',
  frozen: 'Refused: the charter is frozen',
  expired: 'Refused: the rule has expired',
  window: 'Refused: outside the allowed hours',
  min_amount: 'Refused: under the minimum',
  bad_signature: 'Refused: the agent signature did not match',
  replay: 'Refused: that request was already used',
};

export function reasonLabel(code) {
  if (code == null || code === '') return '';
  const key = String(code);
  return REASONS[key] || 'Refused';
}
