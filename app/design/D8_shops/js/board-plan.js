// Pure plans for a visitor's row on the live board. No wallet and no network.
// Payments stay at or under 0.005 NEAR. The board has no batch method.
// Same text as shared/board/seal.js (the unit test checks they stay equal).
export function sealText({ contract, deny = [], salt, max = 'none' }) {
  return `oath-hidden-v1|${contract}|pay|${max}|${deny.join(',')}|${salt}`;
}
export const MAX_NEAR = 0.005;
export const MAX_YOCTO = 5_000_000_000_000_000_000_000n;
export const PAYOUT_N = 3;
export const PAYOUT_TOTAL = 0.01;
export const MAX_RECEIVERS = 8;

const near = n => { const x = Number(n); if (!Number.isFinite(x)) throw new Error('amount must be a number'); return Math.round(x * 1e6) / 1e6; };

/** Next per-payment cap (yocto string). Never above 0.005 NEAR, the row's daily budget, or below its minimum. */
export function nextCap(row, kind) {
  const cap = BigInt(row.per_action_cap);
  const budget = BigInt(row.daily_budget);
  const min = BigInt(row.min_amount);
  let next = kind === 'tighter' ? cap * 3n / 5n : (cap * 8n) / 5n;
  if (next > budget) next = budget;
  if (next > MAX_YOCTO) next = MAX_YOCTO;
  if (next < min) throw new Error('cap would sit under your minimum');
  if (next <= 0n) throw new Error('cap would be zero');
  return { cap: next.toString(), unchanged: next === cap };
}

/** Up to 3 sequential payments. Not one atomic batch. */
export function boardPayoutPlan(rows, receivers) {
  if (!Array.isArray(receivers) || receivers.length < 1 || receivers.length > MAX_RECEIVERS) throw new Error('the allowlist holds 1 to 8 receivers');
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > PAYOUT_N) throw new Error('one at a time, not all-or-nothing: 1 to 3 payments');
  let total = 0;
  const steps = rows.map(r => {
    const amt = near(r.amt);
    if (!(amt > 0) || amt - MAX_NEAR > 1e-9) throw new Error('each payment is at most 0.005 NEAR');
    if (!receivers.includes(r.to)) { const e = new Error('receiver_not_allowlisted'); e.reason = 'receiver_not_allowlisted'; throw e; }
    total += amt;
    return { to: r.to, amt };
  });
  total = Math.round(total * 1e6) / 1e6;
  if (total - PAYOUT_TOTAL > 1e-9) throw new Error('the list is over the 0.01 NEAR daily budget');
  return { steps, total, mode: 'one at a time, not all-or-nothing' };
}
