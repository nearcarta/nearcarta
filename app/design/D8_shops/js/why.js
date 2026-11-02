// "Why it refused": turns a refusal code from the charter into one plain sentence with the numbers
// the contract compared. Pure (no DOM, no three.js) so the unit tests and the 2D view can use it.
const n = v => (v == null ? '?' : `${+Number(v).toFixed(4)} NEAR`);
const RULES = {
  over_per_action_cap: (a, c) => [`Per-action cap`, `It asked for ${n(a.amount)}; one action may move at most ${n(c?.cap)}.`],
  over_daily_budget: (a, c) => [`Budget`, `It asked for ${n(a.amount)}; the clause budget is ${n(c?.budget)} and earlier actions already used part of it.`],
  receiver_not_allowlisted: (a, c) => [`Payee allowlist`, `The receiver is not on the clause's list (${(c?.payees || []).join(', ') || 'empty'}).`],
  frozen: () => [`Freeze`, `The owner or DAO froze the charter; nothing moves until they unfreeze it.`],
  over_cap_waiting_owner: (a, c) => [`Escalation`, `${n(a.amount)} is over the ${n(c?.cap)} cap, so it is held until ${c?.escalate?.by || 'the owner'} answers.`],
  escalation_timed_out: (a, c) => [`Escalation timeout`, `Nobody approved it within ${c?.escalate?.timeout || 'the window'}, so the held action was refused.`],
  receipt_required: () => [`Receipt`, `This clause only pays against a signed receipt, and none was attached.`],
  receipt_signature_invalid: () => [`Receipt`, `The receipt's signature did not verify against the expected signer.`],
  receipt_replayed: () => [`Receipt`, `That receipt was already used once; each receipt pays at most once.`],
};
export const KNOWN = Object.keys(RULES);
export function explain(act, clauses = []) {
  const code = act.reason || '';
  const c = clauses.find(x => x.id === act.clause);
  const f = RULES[code];
  if (!f) return { code, rule: 'Contract rule', plain: `The contract refused with ${code.replaceAll('_', ' ') || 'no code'}.`, known: false };
  const [rule, plain] = f(act, c);
  return { code, rule, plain, known: true };
}
// Fast-forward replay: real decisions at their recorded spacing (act.t, seconds), squeezed by `speed`.
// Returns [{ at (ms from start), act }] in time order; gaps are capped so a long idle stretch still plays.
export function replayPlan(acts, speed = 8, maxGapS = 30) {
  const s = Math.max(1, Number(speed) || 1);
  const xs = acts.filter(a => Number.isFinite(a.t)).slice().sort((a, b) => a.t - b.t);
  let at = 0, prev = xs[0]?.t ?? 0;
  return xs.map(a => { at += Math.min(a.t - prev, maxGapS) * 1000 / s; prev = a.t; return { at: Math.round(at), act: a }; });
}
