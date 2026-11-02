// One receipt per agent action, plus at most one counter-offer when the ask is over plan.
// Pure functions: the browser and the API build the same receipt from the same inputs.
const Y = 10n ** 24n;
export const near = y => { const b = BigInt(y || 0); const w = b / Y, f = (b % Y).toString().padStart(24, '0').replace(/0+$/, ''); return f ? `${w}.${f.slice(0, 6)}` : `${w}`; };

/** Counter-offer: if the amount is over the clause cap and the receiver is allowlisted, offer the cap once. */
export function counterOffer({ receiver, amount }, clause) {
  if (!clause) return null;
  const cap = BigInt(clause.per_action_cap || 0), amt = BigInt(amount || 0);
  if (!(cap > 0n) || amt <= cap) return null;
  if (!(clause.receivers || []).includes(receiver)) return null; // never bargain with a stranger
  return { amount: cap.toString(), amount_near: near(cap),
    why: `You asked for ${near(amt)} NEAR; the plan allows at most ${near(cap)} NEAR per action to ${receiver}. I can pay ${near(cap)} NEAR now; the rest needs the owner.` };
}

/** Receipt: what, to whom, price, who decided, and whether each check passed. */
export function receipt({ note, receiver, amount, by, model, verification, cost, decision, reason, tx, clause_id }, clause) {
  return {
    what: note || 'payment',
    to: receiver,
    price_near: near(amount),
    price_yocto: String(amount || '0'),
    decided_by: by === 'model' ? `model ${model}` : 'rule parser (no model)',
    checks: {
      model_reply_verified: verification ? !!verification.verified : null,
      within_plan: clause ? BigInt(amount || 0) <= BigInt(clause.per_action_cap || 0) && (clause.receivers || []).includes(receiver) : null,
      charter: decision || null,
    },
    charter_reason: reason || null,
    clause_id: clause_id || null,
    inference_usd: cost?.usd ?? 0,
    tx: tx || null,
    counter_offer: decision && decision !== 'allowed' ? counterOffer({ receiver, amount }, clause) : null,
  };
}
