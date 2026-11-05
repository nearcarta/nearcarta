// Default NEAR to add on /setup Try it, and the control that asks for it.
// fund() adds the attached deposit to the row balance:
// contracts/charter_board/src/lib.rs lines 202–206.
// close_charter / release sends that balance back: lines 208–209 and 229.
const YN = 10n ** 24n;

export const TOPUP_STEP_YOCTO = YN / 200n; // 0.005 NEAR
export const TOPUP_MIN_YOCTO = YN / 1000n; // 0.001 NEAR
export const TOPUP_RESERVE_YOCTO = YN / 100n; // 0.01 NEAR left on the account for gas
const HEADROOM_YOCTO = YN / 100n; // cap + 0.01, and the floor target of 0.01

const big = v => {
  if (typeof v === 'bigint') return v;
  if (v == null || v === '') return 0n;
  return BigInt(v);
};

/** Room left after keeping 0.01 NEAR on the account for gas. Null when the balance is unknown. */
export function topUpRoom(accountYocto) {
  if (accountYocto == null || accountYocto === '') return null;
  const acct = big(accountYocto);
  return acct > TOPUP_RESERVE_YOCTO ? acct - TOPUP_RESERVE_YOCTO : 0n;
}

/**
 * Yocto to add so the row reaches max(cap + 0.01, 0.01).
 * Rounded up to 0.005, then at least 0.001, then never more than the account minus 0.01.
 * A null account balance is not clamped.
 */
export function charterTopUpYocto({ capYocto = 0n, rowYocto = 0n, accountYocto = null } = {}) {
  const cap = big(capYocto);
  const row = big(rowYocto);
  const withHeadroom = cap + HEADROOM_YOCTO;
  const target = withHeadroom > HEADROOM_YOCTO ? withHeadroom : HEADROOM_YOCTO;
  const raw = target > row ? target - row : 0n;
  const step = TOPUP_STEP_YOCTO;
  let amt = raw === 0n ? 0n : ((raw + step - 1n) / step) * step;
  if (amt < TOPUP_MIN_YOCTO) amt = TOPUP_MIN_YOCTO;
  const room = topUpRoom(accountYocto);
  if (room != null && amt > room) amt = room;
  return amt;
}

/** NEAR string from yocto, trimmed, no float rounding. */
export function nearStringFromYocto(y) {
  const v = big(y);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / YN;
  const frac = (a % YN).toString().padStart(24, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + whole.toString() + (frac ? '.' + frac : '');
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Always-visible add control. The low-balance hint stays when lowBalance is set.
 * The refund sentence is above the button, so it is on screen before the approval.
 */
export function charterFundMarkup({ amountNear = '', lowBalance = false, rowNear = '?', hintNear = '0.005', busy = false, disabled = false, note = '' } = {}) {
  const hint = lowBalance
    ? `<div class="tabhelp" data-testid="try-lowbal"><p class="small">Your charter holds ${esc(rowNear)} NEAR. Payments come from the charter's own balance, not your account. Add ${esc(hintNear)} NEAR to it with one approval.</p></div>`
    : '';
  const off = busy || disabled;
  const extra = note ? `<p class="small" data-testid="try-fund-limit">${esc(note)}</p>` : '';
  return `${hint}<form class="tabhelp" data-testid="try-fund" id="try-fund">
    <p class="small" data-testid="try-fund-back">This amount goes to your charter's row balance. It comes back to you on close_charter (teardown).</p>
    <div class="field"><label for="t-fund-amt">Amount to add</label><div class="suffix"><input id="t-fund-amt" name="amount" type="number" inputmode="decimal" step="0.001" min="0.001" value="${esc(amountNear)}" data-testid="try-fund-amt"${busy ? ' disabled' : ''}><span>NEAR</span></div></div>
    ${extra}
    <button type="submit" class="btn" id="t-topup" data-testid="try-topup"${off ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}>${busy ? 'Adding… waiting for confirmation' : 'Add NEAR to the charter'}</button>
  </form>`;
}
