// The charter policy a visitor can read. Numbers are NEAR, not yocto.

const nearOf = y => {
  if (y == null || y === '') return null;
  try { return Number(BigInt(y)) / 1e24; } catch { return null; }
};

export function policyView({ state = null, clauses = null, methods = null } = {}) {
  const pay = clauses && clauses.pay ? clauses.pay : null;
  const list = Array.isArray(methods) && methods.length ? methods.slice() : ['propose', 'propose_batch'];
  return {
    allowlist: Array.isArray(pay?.receivers) ? pay.receivers.slice() : [],
    perActionNear: pay ? nearOf(pay.per_action_cap) : null,
    dailyBudgetNear: pay ? nearOf(pay.daily_budget) : null,
    dailyCount: pay?.max_actions_per_day ?? null,
    windowStart: pay?.window_start_min ?? null,
    windowEnd: pay?.window_end_min ?? null,
    frozen: state?.frozen === true,
    sealed: !!(state?.sealed || state?.hidden_rule),
    agentMethods: list,
    agentCannotUnfreeze: true,
  };
}
