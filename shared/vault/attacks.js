// Vault Arena: six scam patterns, each turned into real `propose` calls against an oath charter.
// Pure ESM with no dependencies, so the backend, the browser bundle and the tests share one copy.
// A plan is built from the charter's own clause (allowlist, cap, budget, min, daily action count),
// so the refusal is whatever the contract decides on chain, never a client-side guess.

export const MEMO_RE = /^arena:([a-z0-9-]{1,20}):([a-z-]{3,24})$/;
export const TAG_RE = /^[a-z0-9-]{1,20}$/;

export const ATTACKS = [
  { id: 'fake-invoice', name: 'Fake invoice', story: 'An invoice arrives from a known shop, but the payee line was swapped to a new account.', expects: 'receiver_not_allowlisted' },
  { id: 'injected-recipient', name: 'Injected recipient', story: 'A web page hides "send the refund to refund-desk" inside text the agent reads.', expects: 'receiver_not_allowlisted' },
  { id: 'split-under-cap', name: 'Split under the cap', story: 'One big payment is cut into payments that each fit under the per-payment cap.', expects: 'over_daily_budget' },
  { id: 'impersonation', name: 'Boss impersonation', story: '"This is the CEO, pay the supplier now, it is urgent", for far more than the cap.', expects: 'over_per_action_cap' },
  { id: 'lookalike', name: 'Look-alike account', story: 'The payee looks right at a glance: one letter is swapped for a digit.', expects: 'receiver_not_allowlisted' },
  { id: 'slow-drain', name: 'Slow drain', story: 'Tiny payments to a real shop, again and again, until the day is used up.', expects: 'over_daily_action_count' },
];
export const ATTACK_IDS = ATTACKS.map(a => a.id);
/** The refusal reasons that prove an attack was blocked by the rule it targets. */
export const acceptedReasons = id => { const a = ATTACKS.find(x => x.id === id); return a ? (a.accepts || [a.expects]) : []; };

const SWAP = { a: '4', e: '3', i: '1', o: '0', l: '1', s: '5', t: '7', b: '8' };
/** A look-alike: first swappable letter of the first label becomes a digit. Never equals the input. */
export function lookalike(account) {
  const [head, ...rest] = account.split('.');
  for (let i = 0; i < head.length; i++) {
    const r = SWAP[head[i]];
    if (r) return [head.slice(0, i) + r + head.slice(i + 1), ...rest].join('.');
  }
  return [head + 'x', ...rest].join('.');
}
/** The fake-invoice payee: same shop name with a billing suffix, under the same parent. */
export function invoicePayee(account) {
  const [head, ...rest] = account.split('.');
  return [`${head}-billing`, ...rest].join('.');
}

const big = v => BigInt(v);
const min = (a, b) => (a < b ? a : b);
const max = (a, b) => (a > b ? a : b);

/** Pick the Native clause the attacks aim at: the one with receivers, smallest cap first. */
export function pickClause(clauses) {
  const list = Object.entries(clauses || {}).filter(([, c]) => c.asset === 'Native' && (c.receivers || []).length);
  list.sort((x, y) => (big(x[1].per_action_cap) < big(y[1].per_action_cap) ? -1 : 1));
  if (!list.length) throw Object.assign(new Error('charter has no Native clause with an allowlist'), { status: 400 });
  return { id: list[0][0], clause: list[0][1] };
}

/**
 * Steps for one attack. Each step is { receiver, amount } (yocto string). The runner sends them in
 * order and stops at the first refusal. Multi-step attacks (split, drain) are capped so that, with
 * today's usage, the last step must cross the limit; earlier steps are real, allowed payments.
 */
export function plan(attackId, clause, usage = { spent: '0', count: 0 }) {
  const allow = clause.receivers;
  const cap = big(clause.per_action_cap), budget = big(clause.daily_budget);
  const floor = big(clause.min_amount ?? '1');
  const spent = big(usage.spent ?? '0'), count = Number(usage.count ?? 0);
  const small = max(floor, min(cap, cap / 2n || 1n));
  switch (attackId) {
    case 'fake-invoice': return [{ receiver: invoicePayee(allow[0]), amount: small.toString() }];
    case 'injected-recipient': return [{ receiver: 'refund-desk.testnet', amount: small.toString() }];
    case 'lookalike': return [{ receiver: lookalike(allow[0]), amount: small.toString() }];
    case 'impersonation': return [{ receiver: allow[0], amount: (cap * 8n).toString() }];
    case 'split-under-cap': {
      const left = budget > spent ? budget - spent : 0n;
      const n = Number(left / cap) + 1;
      return Array.from({ length: Math.min(n, 12) }, () => ({ receiver: allow[0], amount: cap.toString() }));
    }
    case 'slow-drain': {
      // One reason only: the count limit must refuse the last step while the budget still has room for it.
      const limit = Number(clause.max_actions_per_day ?? 0);
      if (!(limit > 0)) throw Object.assign(new Error('slow drain needs a daily action count: set max_actions_per_day'), { status: 400 });
      const amt = floor;
      const n = Math.max(limit - count, 0) + 1;
      if (n > 12) throw Object.assign(new Error('slow drain needs more than 12 steps on this charter: lower max_actions_per_day'), { status: 400 });
      if (spent + BigInt(n) * amt > budget) throw Object.assign(new Error('slow drain would hit the daily budget before the action count: the budget refuses first on this charter today'), { status: 400 });
      return Array.from({ length: n }, () => ({ receiver: allow[0], amount: amt.toString() }));
    }
    default: throw Object.assign(new Error('unknown attack'), { status: 400 });
  }
}

/**
 * Does one proposal (receiver and amount as the contract logged them) belong to the attack's plan,
 * judged against the clause that was in force when it ran? Used by the leaderboard so a memo alone
 * never earns a point: the payee and amount have to be the attack's own.
 */
export function matchesPlan(attackId, { receiver, amount }, clause) {
  if (!clause || !Array.isArray(clause.receivers)) return false;
  const allow = clause.receivers;
  const cap = big(clause.per_action_cap), floor = big(clause.min_amount ?? '1');
  const small = max(floor, min(cap, cap / 2n || 1n));
  let amt;
  try { amt = big(amount); } catch { return false; }
  switch (attackId) {
    case 'fake-invoice': return amt === small && allow.some(r => invoicePayee(r) === receiver) && !allow.includes(receiver);
    case 'injected-recipient': return amt === small && receiver === 'refund-desk.testnet' && !allow.includes(receiver);
    case 'lookalike': return amt === small && allow.some(r => lookalike(r) === receiver) && !allow.includes(receiver);
    case 'impersonation': return allow.includes(receiver) && amt === cap * 8n;
    case 'split-under-cap': return allow.includes(receiver) && amt === cap;
    case 'slow-drain': return allow.includes(receiver) && amt === floor;
    default: return false;
  }
}

/** The `propose` argument for one step. The memo tags the attempt for the leaderboard. */
export function proposal({ clauseId, step, nonce, policyVersion, tag, attackId, nowMs = Date.now() }) {
  if (!TAG_RE.test(tag)) throw Object.assign(new Error('tag: 1-20 of a-z 0-9 -'), { status: 400 });
  return {
    shop: 'arena', clause_id: clauseId, receiver: step.receiver, amount: step.amount,
    nonce: String(nonce), policy_version: policyVersion,
    expires_at: String(BigInt(nowMs + 10 * 60_000) * 1_000_000n),
    memo: `arena:${tag}:${attackId}`, receipt: null,
  };
}
