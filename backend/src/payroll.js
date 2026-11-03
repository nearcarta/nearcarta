// Payouts: the testnet USDC payroll. The record (judges/proofs/payroll-usdc.json) names the charter and its txs;
// the rule, usage and USDC balances are read live from NEAR testnet on each call.
import { readFileSync } from 'node:fs';
import { view } from './near.js';

const P = JSON.parse(readFileSync(new URL('../../judges/proofs/payroll-usdc.json', import.meta.url), 'utf8'));
const tx = s => P.steps.find(x => x.step.startsWith(s))?.tx || null;
const usdc = s => (s == null ? null : Number(s) / 1e6);

export async function payroll() {
  const [clauses, usage, ...bals] = await Promise.all([view(P.charter, 'get_clauses'), view(P.charter, 'get_usage', { clause_id: 'payroll' }).catch(() => null),
    ...[P.charter, ...P.staff].map(a => view(P.token, 'ft_balance_of', { account_id: a }))]);
  const c = clauses.payroll;
  return { network: 'testnet', token: P.token, token_name: 'USDC (Circle testnet)', charter: P.charter, owner: P.owner, staff: P.staff,
    rule: c && { receivers: c.receivers, per_payment_usdc: usdc(c.per_action_cap), per_day_usdc: usdc(c.daily_budget), payments_per_day: c.max_actions_per_day },
    usage, float_usdc: usdc(bals[0]), staff_usdc: Object.fromEntries(P.staff.map((a, i) => [a, usdc(bals[i + 1])])),
    txs: { create_charter: tx('create_charter'), storage_deposits: P.steps.filter(x => x.step.startsWith('storage_deposit')).map(x => x.tx),
      rule_and_agent_key: tx('owner_sets'), fund: tx('owner_funds'), paid_in_cap: tx('agent_pays'), refused_over_cap: tx('agent_tries') },
    outcomes: { paid: JSON.parse(P.outcomes.paid), refused: JSON.parse(P.outcomes.refused) } };
}
