// Foreign payroll rows on the Payouts shop. Each row is one 1Click EXACT_OUTPUT swap paid from the
// visitor's own session: the board's propose_call deposits wNEAR, and 1Click pays the payee exactly
// `amt` of the row's asset on the row's chain. This file does not sign and does not send the deposit.
// The gate is the visitor's own row (not a shop allowlist): frozen, expiry, per-payment cap, daily
// budget and payments-per-day count, all read from the board. There is no price constant here.
// https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types
// https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart
import { echoGuard, findToken, tokens, postQuote, statusHelp, validDepositAddress } from './ferry.js';
import { defaultVerify, fetchOneClickStatus } from './ferry-checkout.js';
import { addressOk } from '../../app/src/panels/payouts-plan.js';
import { intentsCheckout } from '../../shared/rails/receipts.js';

const FINAL = ['SUCCESS', 'REFUNDED', 'FAILED'];
const REFUND_SAMPLE = '561e8ef0fecb621469da30250dc6cdcd1e47a66e561e8ef0fecb621469da3025';

/**
 * One row is one swap. The key is the row itself (owner, chain, asset, payee, amount), not a clock,
 * so a second checkout for the same row returns the deposit address the first one got instead of
 * asking 1Click for a second swap. A row whose swap already SUCCEEDED is refused outright.
 * This is per host memory; the status route is what decides paid, and the row cap is what decides
 * whether the session can send it again.
 */
const ROWS = new Map();
export const payrollRowId = ({ owner = '', chain = '', asset = '', to = '', amt = '' } = {}) =>
  [String(owner).toLowerCase(), String(chain).toLowerCase(), String(asset).toUpperCase(), String(to).trim().toLowerCase(), String(amt)].join('|');
export function resetPayrollRows() { ROWS.clear(); }
export function rememberPayrollRow(key, value) {
  ROWS.set(key, value);
  while (ROWS.size > 200) ROWS.delete(ROWS.keys().next().value);
}
export function knownPayrollRow(key) { return ROWS.get(key) || null; }

/**
 * The visitor's own row as a gate for one foreign row. `amtNear` is the wNEAR the session deposits.
 * The same fields contracts/charter_board checks in propose_call, read before a deposit address exists.
 */
export function payrollRowGate({ row, amtNear, nowMin = null } = {}) {
  if (!row) return { ok: false, reason: 'no_row' };
  if (row.per_action_cap == null || row.per_action_cap === '') return { ok: false, reason: 'no_row' };
  if (row.frozen) return { ok: false, reason: 'frozen' };
  if (Number(row.expires_at || 0) > 0) {
    const ms = Number(BigInt(String(row.expires_at)) / 1_000_000n);
    if (Number.isFinite(ms) && ms < Date.now()) return { ok: false, reason: 'clause_expired' };
  }
  const cap = Number(BigInt(String(row.per_action_cap)) / 10n ** 18n) / 1e6;
  const near = Number(amtNear);
  if (!Number.isFinite(near) || near <= 0) return { ok: false, reason: 'bad_amount' };
  if (near > cap + 1e-12) return { ok: false, reason: 'over_per_action_cap', cap };
  const budget = Number(BigInt(String(row.daily_budget ?? row.per_action_cap)) / 10n ** 18n) / 1e6;
  const spent = Number(BigInt(String(row.spent_today ?? '0')) / 10n ** 18n) / 1e6;
  if (spent + near > budget + 1e-12) return { ok: false, reason: 'over_daily_budget', cap };
  const count = Number(row.actions_today ?? 0), max = Number(row.max_actions_per_day ?? 0);
  if (max > 0 && count >= max) return { ok: false, reason: 'over_daily_action_count' };
  const s = Number(row.window_start_min ?? 0), e = Number(row.window_end_min ?? 0);
  if (s !== e && nowMin != null) {
    const m = Number(nowMin);
    const open = s < e ? (m >= s && m < e) : (m >= s || m < e);
    if (!open) return { ok: false, reason: 'outside_time_window' };
  }
  if (row.balance != null && row.balance !== '') {
    const bal = Number(BigInt(String(row.balance)) / 10n ** 18n) / 1e6;
    if (bal < near) return { ok: false, reason: 'ERR_BALANCE' };
  }
  return { ok: true, reason: null, cap };
}

export const utcMinute = (d = new Date()) => d.getUTCHours() * 60 + d.getUTCMinutes();

export function payrollCheckoutInput(b) {
  if (!b || typeof b !== 'object') return { error: 'body must be a JSON object' };
  const chain = String(b.chain || '').toLowerCase();
  const asset = String(b.asset || 'USDC').toUpperCase();
  const to = String(b.to || '').trim();
  const near = Number(b.near);
  const amt = Number(b.amt);
  if (!chain || chain === 'near') return { error: 'a NEAR row is a propose, not a swap' };
  if (!addressOk(chain, to)) return { error: 'bad recipient for this chain' };
  if (!(amt > 0)) return { error: 'bad amount' };
  if (!(near > 0)) return { error: 'bad near amount' };
  const refundTo = String(b.refundTo || '').trim();
  if (!addressOk('near', refundTo)) return { error: 'bad refundTo: a NEAR account holds the refund' };
  if (!/^[A-Z0-9]{2,12}$/.test(asset)) return { error: 'bad asset' };
  const owner = String(b.owner || '').trim();
  return { ok: true, value: { chain, asset, to, amt, near, refundTo, owner, slippage: Number(b.slippage) || 100 } };
}

function toUnits(amount, decimals) {
  const [w, f = ''] = String(amount).split('.');
  if (!/^\d+$/.test(w) || !/^\d*$/.test(f) || f.length > decimals) return null;
  return (BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}

/**
 * A live EXACT_OUTPUT quote for one payroll row, so 1Click returns a deposit address for the wNEAR.
 * `dry:false` is required for a deposit address; nothing is sent and no key is used.
 */
export async function openPayrollCheckout(input, deps = {}) {
  const row = deps.row;
  const key = payrollRowId({ owner: input.owner, chain: input.chain, asset: input.asset, to: input.to, amt: input.amt });
  const seen = knownPayrollRow(key);
  if (seen) {
    // A second click on the same row: the same deposit address, never a second swap.
    return {
      ok: true, replayed: true, status: seen.status, help: statusHelp(seen.status),
      depositAddress: seen.depositAddress, depositMemo: seen.depositMemo || null,
      near: seen.near, out: seen.out, chain: seen.chain, asset: seen.asset, to: seen.to,
      refundTo: seen.refundTo, deadline: seen.deadline || null,
      receipt: intentsCheckout({ what: 'payroll row deposit address', to: seen.to, amount: seen.amt, asset: seen.asset, decision: 'allowed', tx: seen.depositAddress }),
    };
  }
  const gate = payrollRowGate({ row, amtNear: input.near, nowMin: utcMinute() });
  if (!gate.ok) {
    return {
      ok: false, reason: gate.reason, depositAddress: null,
      receipt: intentsCheckout({ decision: 'refused', reason: gate.reason, to: input.to, amount: input.amt, asset: input.asset, tx: null }),
    };
  }
  const list = await (deps.tokens || tokens)();
  const from = findToken(list, 'wNEAR@near');
  const to = findToken(list, `${input.asset}@${input.chain}`);
  if (!from || !to) return { ok: false, reason: 'unknown_token', depositAddress: null };
  const units = toUnits(input.amt, to.decimals);
  if (!units) return { ok: false, reason: 'bad_amount', depositAddress: null };
  const body = {
    dry: false,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: input.slippage,
    originAsset: from.assetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: to.assetId,
    amount: units,
    refundTo: input.refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: input.to,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 30 * 60e3).toISOString(),
  };
  const post = deps.postQuote || postQuote;
  const res = await post(body);
  if (res.http !== 201) {
    return {
      ok: false, reason: 'quote_refused', depositAddress: null,
      error: res.body?.message || `1Click answered HTTP ${res.http}`,
      receipt: intentsCheckout({ decision: 'refused', reason: 'quote_refused', to: input.to, amount: input.amt, asset: input.asset, tx: null }),
    };
  }
  // Signature, echo and a real deposit address. There is no dollar ceiling here: the row cap is the
  // visitor's own per-payment cap, checked above and again below on the signed amountInFormatted.
  let signature = false;
  try { signature = !!(deps.verify || defaultVerify)(res.body); } catch { signature = false; }
  const echo = echoGuard(body, res.body.quoteRequest);
  const accepted = signature && echo.ok && validDepositAddress(res.body?.quote?.depositAddress);
  if (!accepted) {
    return {
      ok: false, reason: 'quote_refused', depositAddress: null,
      receipt: intentsCheckout({ decision: 'refused', reason: 'quote_refused', to: input.to, amount: input.amt, asset: input.asset, tx: null }),
    };
  }
  const q = res.body.quote || {};
  const near = Number(q.amountInFormatted);
  const after = payrollRowGate({ row, amtNear: near, nowMin: utcMinute() });
  if (!after.ok) {
    return {
      ok: false, reason: after.reason, depositAddress: null,
      receipt: intentsCheckout({ decision: 'refused', reason: after.reason, to: input.to, amount: input.amt, asset: input.asset, tx: null }),
    };
  }
  rememberPayrollRow(key, {
    depositAddress: q.depositAddress, depositMemo: q.depositMemo || null, status: 'PENDING_DEPOSIT',
    near, out: q.amountOutFormatted || String(input.amt), chain: input.chain, asset: input.asset,
    to: input.to, amt: input.amt, refundTo: input.refundTo, deadline: q.deadline || body.deadline,
  });
  return {
    ok: true,
    replayed: false,
    reason: null,
    status: 'PENDING_DEPOSIT',
    help: statusHelp('PENDING_DEPOSIT'),
    depositAddress: q.depositAddress,
    depositMemo: q.depositMemo || null,
    near,
    out: q.amountOutFormatted || String(input.amt),
    outUsd: Number(q.amountOutUsd) || null,
    nearUsd: Number(q.amountInUsd) || null,
    minutes: Number(q.timeEstimate) || null,
    deadline: q.deadline || body.deadline,
    correlationId: res.body.correlationId || null,
    chain: input.chain,
    asset: input.asset,
    to: input.to,
    refundTo: input.refundTo,
    receipt: intentsCheckout({
      what: 'payroll row deposit address', to: input.to, amount: input.amt, asset: input.asset,
      decision: 'allowed', tx: validDepositAddress(q.depositAddress) ? q.depositAddress : null,
    }),
  };
}

/** One status word for a payroll row, in plain words. A row is paid only on SUCCESS. */
export function payrollRowStatus(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'SUCCESS') return { paid: true, final: true, text: 'Paid.' };
  if (s === 'REFUNDED') return { paid: false, final: true, text: 'Refunded to your refund address. Nothing else was sent.' };
  if (s === 'FAILED') return { paid: false, final: true, text: 'The swap failed. The refund line says where the wNEAR went.' };
  if (s === 'INCOMPLETE_DEPOSIT') return { paid: false, final: false, text: 'The deposit was short of the quote. Not paid yet.' };
  if (s === 'KNOWN_DEPOSIT_TX' || s === 'PROCESSING') return { paid: false, final: false, text: 'The deposit was seen. Not paid yet.' };
  if (s === 'PENDING_DEPOSIT') return { paid: false, final: false, text: 'Waiting for the deposit.' };
  return { paid: false, final: false, text: 'No settled status yet. Not paid.' };
}

export async function payrollStatus(depositAddress, f = fetch) {
  if (!validDepositAddress(depositAddress)) throw Object.assign(new Error('not a deposit address'), { status: 400 });
  const st = await fetchOneClickStatus(depositAddress, f);
  for (const [k, v] of ROWS) if (v.depositAddress === depositAddress) ROWS.set(k, { ...v, status: st.status });
  return { ...st, ...payrollRowStatus(st.status), final: FINAL.includes(st.status) };
}

export const __test = { REFUND_SAMPLE, toUnits };
