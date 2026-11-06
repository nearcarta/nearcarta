// NEAR Intents on 1Click: the parts Ferry uses beyond a plain on-chain deposit swap.
//
// Three capabilities live here, all against 1Click's /v0 API:
//  - signed intent execution: a quote with `depositType: INTENTS` (or CONFIDENTIAL_INTENTS)
//    is funded by an off-chain signature instead of an on-chain deposit. The visitor (or
//    their session key) signs the payload /v0/generate-intent returns, and
//    /v0/submit-intent submits it. No NEAR transaction is sent for the deposit.
//  - limit orders: the visitor names their own price. /v0/orders creates one, the order
//    rests until it fills, is cancelled, or its deadline passes, and an unfilled remainder
//    is refunded to the address the order was created with.
//  - signature checks: every quote and every status payload is checked against the 1Click
//    manager key before a deposit address or a "delivered" line is shown.
//
// This file has no imports, so the browser and the backend use the same rules.
// Docs in docs/internal/intents/. API host: https://1click.chaindefuser.com

/** The 1Click manager key that signs quote payloads. Public; not a secret. */
export const ONE_CLICK_MANAGER_PUB_KEY = 'ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc';

/** Deposit channels. ORIGIN_CHAIN is an on-chain transfer; the other two are signed. */
export const DEPOSIT_TYPES = ['ORIGIN_CHAIN', 'INTENTS', 'CONFIDENTIAL_INTENTS'];
/** Which deposit channels need an off-chain signature instead of a deposit tx. */
export const SIGNED_DEPOSIT_TYPES = ['INTENTS', 'CONFIDENTIAL_INTENTS'];
/** Confidentiality levels a quote or order may ask for. */
export const CONFIDENTIALITY = ['public', 'basic', 'advanced'];

/** True when this deposit type is funded by a signed intent, not an on-chain deposit. */
export function needsSignedIntent(depositType) {
  return SIGNED_DEPOSIT_TYPES.includes(String(depositType || '').toUpperCase());
}

/**
 * A quote or order may only ask for a confidentiality level the API documents, and a
 * confidential swap needs the partner key on the server. Refuses before any 1Click call.
 */
export function confidentialityCheck(level, { hasPartnerKey = false } = {}) {
  const v = String(level || 'public').toLowerCase();
  if (!CONFIDENTIALITY.includes(v)) return { ok: false, reason: 'bad_confidentiality', level: v };
  if (v !== 'public' && !hasPartnerKey) return { ok: false, reason: 'confidential_needs_partner_key', level: v };
  return { ok: true, level: v };
}

/**
 * Order side and the amount the visitor must deposit, from the docs' own formula:
 *   quote-side amount = quantity × price × 10^quoteDecimals / 10^baseDecimals
 * rounded up to a whole smallest unit. A SELL spends the base asset, a BUY the quote.
 * https://docs.near-intents.org/integration/distribution-channels/1click-api/orders
 */
export function orderDeposit({ side, quantity, price, baseDecimals, quoteDecimals }) {
  const q = BigInt(String(quantity ?? '0'));
  const p = String(price ?? '');
  if (!/^\d+(\.\d+)?$/.test(p)) throw new Error('price must be a positive decimal');
  if (q <= 0n) throw new Error('quantity must be positive');
  const [whole, frac = ''] = p.split('.');
  const scale = 10n ** BigInt(frac.length);
  const priceScaled = BigInt(whole) * scale + BigInt(frac || '0');
  const num = q * priceScaled * 10n ** BigInt(quoteDecimals);
  const den = scale * 10n ** BigInt(baseDecimals);
  const quoteSide = (num + den - 1n) / den; // round up
  const s = String(side || '').toUpperCase();
  if (s === 'SELL') return { side: 'SELL', base: q.toString(), quote: quoteSide.toString(), deposit: q.toString(), swapType: 'EXACT_INPUT' };
  if (s === 'BUY') return { side: 'BUY', base: q.toString(), quote: quoteSide.toString(), deposit: quoteSide.toString(), swapType: 'EXACT_OUTPUT' };
  throw new Error('side must be SELL or BUY');
}

/** Refuse a limit order whose deposit does not fit the visitor's row or balance. */
export function orderFitsRow({ depositYocto, capYocto, balanceYocto }) {
  let d, cap, bal;
  try { d = BigInt(depositYocto); } catch { return { ok: false, reason: 'bad_amount' }; }
  try { cap = BigInt(capYocto); } catch { cap = null; }
  try { bal = balanceYocto == null ? null : BigInt(balanceYocto); } catch { bal = null; }
  if (d <= 0n) return { ok: false, reason: 'bad_amount' };
  if (cap != null && d > cap) return { ok: false, reason: 'over_per_action_cap' };
  if (bal != null && d > bal) return { ok: false, reason: 'over_row_balance' };
  return { ok: true };
}

/**
 * The order fields Ferry sends. 1Click requires `confidentiality` and limit orders always
 * run as confidential swaps, so `public` is refused: there is no way to create a limit
 * order that matches the docs without a level above public.
 */
export function orderInput({
  baseAsset, quoteAsset, quantity, side, price, baseDecimals, quoteDecimals,
  refundTo, refundType, recipient, recipientType, depositType = 'ORIGIN_CHAIN',
  confidentiality = 'basic', appFees = null, deadline = null,
}) {
  for (const [k, v] of Object.entries({ baseAsset, quoteAsset, refundTo, recipient })) {
    if (!v || typeof v !== 'string') throw new Error(`${k} is required`);
  }
  const c = confidentialityCheck(confidentiality, { hasPartnerKey: true });
  if (!c.ok) throw new Error(`order confidentiality ${c.reason}`);
  // A limit order is a confidential swap by definition (docs/internal/intents/limit-orders.md):
  // confidentiality is a required field and `public` is not a resting-order mode.
  if (c.level === 'public') throw new Error('order confidentiality must be basic or advanced');
  const money = orderDeposit({ side, quantity, price, baseDecimals, quoteDecimals });
  const attributes = {
    orderType: 'LIMIT',
    baseAsset, quoteAsset,
    quantity: String(quantity),
    side: money.side,
    price: String(price),
    depositType,
    refundTo, refundType,
    recipient, recipientType,
    confidentiality: c.level,
    timeInForce: 'GTC',
  };
  if (deadline) attributes.deadline = deadline;
  if (appFees && appFees.length) attributes.appFees = appFees;
  return { data: { type: 'orders', attributes } };
}

/**
 * What a visitor sees for one order. Fill status says whether it matched; payout status
 * says whether the filled output and any refund reached their addresses, and only the
 * second one is final. https://docs.near-intents.org/api-reference/order/get-an-order
 */
export function orderView(order) {
  const a = order?.data?.attributes || order?.attributes || order || {};
  const fills = Array.isArray(a.partialFills) ? a.partialFills : [];
  const leg = x => (x && typeof x === 'object' && x.status === 'COMPLETED' && x.txHash ? x.txHash : null);
  return {
    id: order?.data?.id || order?.id || null,
    side: a.side || null,
    baseAsset: a.baseAsset || null,
    quoteAsset: a.quoteAsset || null,
    quantity: a.quantity || null,
    price: a.price || null,
    depositAddress: a.depositAddress || null,
    deposited: a.depositedAmountFormatted || a.depositedAmount || null,
    fillStatus: a.fillStatus || null,
    payoutStatus: a.payoutStatus || null,
    final: a.isPayoutStatusFinal === true,
    fills: fills.length,
    withdrawalTx: leg(a.payouts?.withdrawal),
    refundTx: leg(a.payouts?.refund),
    confidentiality: a.confidentiality || null,
    deadline: a.deadline || null,
    // The docs describe this: an unfilled remainder comes back in payouts.refund, and a
    // cancel is asynchronous, so the last slice can still fill.
    cancelNote: 'Cancel stops matching. Filled output is still withdrawn and the unfilled remainder is refunded to the refund address. A last slice can still fill, so an order may end FILLED instead of CANCELED.',
  };
}

/** Which orders are still working. Terminal states drop out of the open list. */
export const OPEN_FILL_STATUSES = ['AWAITING_DEPOSIT', 'OPEN', 'PARTIALLY_FILLED', 'PENDING_CANCEL'];
export function isOpenOrder(order) {
  const a = order?.data?.attributes || order?.attributes || order || {};
  return OPEN_FILL_STATUSES.includes(a.fillStatus) && a.isPayoutStatusFinal !== true;
}

/**
 * Shape /v0/generate-intent's reply for /v0/submit-intent. The payload bytes must be the
 * ones 1Click returned: the signature covers them, so this never rebuilds or edits them.
 */
export function signedIntentBody(intent, { publicKey, signature }) {
  if (!intent || !intent.standard || intent.payload == null) throw new Error('generate-intent returned no intent');
  if (!publicKey || !signature) throw new Error('a signed intent needs a public key and a signature');
  return { type: 'swap_transfer', signedData: { ...intent, public_key: publicKey, signature } };
}

/**
 * What a status payload is allowed to say. 1Click does not sign the status document
 * itself; the signed thing it carries is `quoteResponse`, which is the quote the deposit
 * belongs to. So a status is trustworthy when that embedded quote still verifies against
 * the manager key. Anything else is shown as unverified, never as delivered.
 */
export function statusSignature(status, verifyQuote) {
  const qr = status?.quoteResponse;
  if (!qr || !qr.signature) return { ok: false, reason: 'no_signed_quote' };
  let ok = false;
  try { ok = !!verifyQuote(qr); } catch { ok = false; }
  return ok ? { ok: true, reason: null } : { ok: false, reason: 'bad_signature' };
}

/**
 * The only statuses that let the boat say delivered. `SUCCESS` must also come from a
 * verified status payload, so an unsigned or tampered document cannot claim delivery.
 */
export function deliveryVerdict(status, sig = { ok: false }) {
  const s = String(status || '').toUpperCase();
  const delivered = s === 'SUCCESS' && sig.ok === true;
  return {
    status: s,
    delivered,
    // Everything else that is terminal and did not deliver.
    failed: !delivered && ['REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT'].includes(s),
    signed: sig.ok === true,
    unchecked: s === 'SUCCESS' && sig.ok !== true,
  };
}
