// The two live board writes Mist Bank makes on the visitor's own row, as pure builders.
//
// Both are signed by the session key that /setup installs in this browser, so neither
// opens a wallet. The contract is the authority, not this file:
//   contracts/charter_board/src/v2.rs   tighten_rules   (shrink-only, refuses ERR_LOOSEN)
//   contracts/charter_board/src/v2.rs   anchor          (writes nothing, logs one event)
//
// tighten_rules takes the full RulesIn and compares every field, so a caller that sends
// back the row it read, with only the cap lowered, is accepted. Sending a guessed rule
// would be refused by the contract, so the row read is mandatory here too.
// https://docs.near.org/protocol/transactions/transaction-anatomy#function-call-actions

const YOCTO_PER_NEAR = 10n ** 24n;

/** NEAR as a plain number, from yocto, rounded to 6 decimals for display. */
export function nearOfYocto(yocto) {
  const y = BigInt(String(yocto || '0'));
  return Number(y / 10n ** 18n) / 1e6;
}

/** The board's RulesIn JSON. Amounts are yoctoNEAR strings, as the contract's parser reads u128. */
export function rulesInFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  const cap = String(row.per_action_cap ?? '');
  if (!/^\d+$/.test(cap) || cap === '0') return null;
  return {
    receivers: Array.isArray(row.receivers) ? row.receivers.map(String) : [],
    per_action_cap: cap,
    daily_budget: String(row.daily_budget ?? cap),
    max_actions_per_day: Number(row.max_actions_per_day ?? 1),
    window_start_min: Number(row.window_start_min ?? 0),
    window_end_min: Number(row.window_end_min ?? 0),
    min_amount: String(row.min_amount ?? '1'),
    expires_at: String(row.expires_at ?? '0'),
  };
}

/**
 * The tighten call for a review. `afterNear` is the cap the audit proposed, in NEAR.
 * Only a lower cap is ever built: the contract refuses anything else, and refusing here
 * says why before a signature exists.
 */
export function tightenCall({ row, afterNear } = {}) {
  const rules = rulesInFromRow(row);
  if (!rules) return { ok: false, why: 'The board did not return a complete row, so there is nothing to tighten. Nothing was signed.' };
  const whole = Math.round(Number(afterNear) * 1e6);
  if (!Number.isFinite(whole) || whole <= 0) return { ok: false, why: 'The proposed cap is not a positive amount. Nothing was signed.' };
  const after = (BigInt(whole) * YOCTO_PER_NEAR) / 1_000_000n;
  const before = BigInt(rules.per_action_cap);
  if (after >= before) {
    return {
      ok: false,
      why: after === before
        ? 'The proposed cap matches your current cap. Nothing was signed.'
        : 'The proposed cap is higher than your current cap. Nothing was signed.',
    };
  }
  // rules_from stays valid: daily_budget >= per_action_cap, and min_amount <= cap.
  if (BigInt(rules.daily_budget) < after) return { ok: false, why: 'The row daily budget is below the proposed cap. Nothing was signed.' };
  if (BigInt(rules.min_amount) > after) return { ok: false, why: 'The row minimum is above the proposed cap. Nothing was signed.' };
  const next = { ...rules, per_action_cap: after.toString() };
  return {
    ok: true,
    method: 'tighten_rules',
    args: { rules: next, freeze: false },
    beforeYocto: before.toString(),
    afterYocto: after.toString(),
    before: nearOfYocto(before),
    after: nearOfYocto(after),
  };
}

/**
 * The anchor call for a salted commitment. The board hashes `salt || digest` itself and
 * stores neither, so the caller passes a digest and a salt and nothing else. The digest
 * is over the audit's own salted text, never the statement.
 */
export function anchorCall({ kind = 'bank_cap', digest, salt } = {}) {
  const d = String(digest || '').replace(/^0x/i, '').toLowerCase();
  const s = String(salt || '');
  if (!/^[0-9a-f]{64}$/.test(d)) return { ok: false, why: 'The commitment digest is not 32 bytes of hex. Nothing was signed.' };
  if (!/^[A-Za-z0-9]{8,64}$/.test(s)) return { ok: false, why: 'The salt must be 8 to 64 letters or digits. Nothing was signed.' };
  const k = String(kind || '');
  if (!/^[A-Za-z0-9_]{1,32}$/.test(k)) return { ok: false, why: 'The anchor kind must be 1 to 32 letters, digits or underscores. Nothing was signed.' };
  return { ok: true, method: 'anchor', args: { kind: k, digest: d, salt: s } };
}

/** One board call, in the shape the sender takes. Same for the CTA and the AI. */
export function boardWrite(call) {
  if (!call?.ok) return call || { ok: false, why: 'Nothing to send.' };
  return { ok: true, method: call.method, args: call.args };
}

/** Board refusals in plain words. The contract's codes are the whole vocabulary. */
const WHY = {
  ERR_LOOSEN: 'the board refused a looser rule',
  ERR_NO_CHARTER: 'the board has no row for this account',
  ERR_DEPOSIT: 'the board asked for more storage deposit',
  ERR_ROW_TOO_BIG: 'the row is at its storage limit',
  ERR_RECEIVERS: 'the payee list would be invalid',
  ERR_CAP: 'the cap would be invalid',
  ERR_BUDGET: 'the daily budget would be below the cap',
  ERR_COUNT: 'the payments-per-day count would be invalid',
  ERR_WINDOW: 'the time window would be invalid',
  ERR_MIN: 'the minimum amount would be invalid',
  ERR_KIND: 'the anchor kind would be invalid',
  ERR_SALT: 'the anchor salt would be invalid',
  ERR_STATE: 'the board state changed unexpectedly',
  ERR_BAD_SIG: 'the signature does not match the agent key in this browser',
  NotEnoughAllowance: 'the session key cannot buy this call; refresh the agent key in /setup',
  ERR_BAD_SIG_OWNER: 'the signature does not match the agent key in this browser',
};

/** A refusal from the chain, named. Never a stack trace and never a raw panic. */
export function boardRefusal(error) {
  const text = String(error?.message || error || '');
  if (!text) return 'the board did not answer';
  for (const key of Object.keys(WHY)) if (text.includes(key)) return WHY[key];
  const m = text.match(/Smart contract panicked:\s*([^\n]{1,120})/);
  if (m) return m[1].trim();
  if (/http (429|502|503|504)|timeout|aborted|fetch failed|ECONNRESET/i.test(text)) return 'the town is busy right now; nothing was signed';
  return text.replace(/^(Error:\s*)?/, '').slice(0, 160);
}
