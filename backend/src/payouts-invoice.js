// Payouts invoices. A dry EXACT_OUTPUT quote names the merchant USDC.
// A deposit address is created only at or under 0.20 USD, after get_charter on the board.
// This file does not sign and does not send the deposit.
// ANY_INPUT is partner-only (1Click docs) and is not requested.
// https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types
// https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote
// https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status
import { invoiceQuoteBody, invoiceDelivered, invoiceStatusLine, CHECKOUT_USD } from '../../app/src/panels/payouts-plan.js';
import { tokenRef, findToken, tokens, postQuote, checkQuote, isNearRecipient, statusHelp } from './ferry.js';
import { checkoutUsdOk, readCharterRules, charterGate, checkLiveQuote, rememberCheckout, oneClickStatus, defaultVerify, MAX_CHECKOUT_USD } from './ferry-checkout.js';

export { CHECKOUT_USD, MAX_CHECKOUT_USD, invoiceDelivered, invoiceStatusLine };

export function invoiceInput(b) {
  if (!b || typeof b !== 'object') return { error: 'body must be a JSON object' };
  const from = tokenRef(b.from);
  const to = tokenRef(b.to || 'USDC@near');
  if (!from) return { error: 'missing or bad from' };
  if (!to) return { error: 'missing or bad to' };
  const usd = Number(b.usd ?? b.amount);
  if (!Number.isFinite(usd) || usd <= 0) return { error: 'bad amount' };
  if (!isNearRecipient(b.recipient)) return { error: 'A NEAR merchant needs a NEAR account as recipient' };
  if (typeof b.refundTo !== 'string' || b.refundTo.length < 2 || b.refundTo.length > 128) return { error: 'bad refundTo' };
  return { ok: true, value: { from, to, usd, recipient: b.recipient, refundTo: b.refundTo, charter: b.charter || b.recipient } };
}

/** Dry quote. depositAddress is always null. Over 0.20 USD never calls 1Click. */
export async function quoteInvoice(input, deps = {}) {
  const cap = checkoutUsdOk(input.usd);
  if (!cap.ok) return { ok: false, reason: cap.reason, dry: true, depositAddress: null, status: null };
  const list = await (deps.tokens || tokens)();
  const from = findToken(list, input.from);
  const to = findToken(list, input.to);
  const built = invoiceQuoteBody({ from, to, usd: input.usd, recipient: input.recipient, refundTo: input.refundTo });
  if (!built.ok) return { ok: false, reason: built.reason, dry: true, depositAddress: null, status: null };
  const post = deps.postQuote || postQuote;
  const res = await post(built.body);
  if (res.http !== 201) {
    return { ok: false, reason: 'quote_refused', dry: true, depositAddress: null, status: null, error: res.body?.message || `HTTP ${res.http}` };
  }
  const checks = (deps.checkQuote || checkQuote)(built.body, res.body);
  const q = res.body.quote || {};
  return {
    ok: !!checks.accepted,
    reason: checks.accepted ? null : 'quote_refused',
    dry: true,
    depositAddress: null,
    status: 'quoted',
    swapType: 'EXACT_OUTPUT',
    usd: q.amountOutUsd || q.amountInUsd || String(input.usd),
    amountIn: q.amountInFormatted || null,
    amountOut: q.amountOutFormatted || null,
    origin: from ? { symbol: from.symbol, chain: from.blockchain } : null,
    destination: to ? { symbol: to.symbol, chain: to.blockchain } : null,
    help: 'Dry quote. No deposit address. Nothing was sent.',
    correlationId: res.body.correlationId || null,
  };
}

/**
 * Live quote with a deposit address. Refuses above 0.20 USD before 1Click.
 * The charter view is get_charter on the board (readCharterRules), not get_rules on the visitor.
 * The 1Click recipient is the merchant NEAR account. It is not the deposit address.
 */
export async function openInvoice(input, deps = {}) {
  const cap = checkoutUsdOk(input.usd);
  if (!cap.ok) return { ok: false, reason: cap.reason, depositAddress: null, status: null, dry: false };
  let chain;
  try {
    chain = await (deps.readCharter || readCharterRules)(input.charter || input.recipient, 'pay');
  } catch (e) {
    return { ok: false, reason: 'charter_unread', error: e.message, depositAddress: null, status: null };
  }
  const gate = charterGate({
    state: chain.state,
    clause: chain.clause,
    usage: chain.usage,
    receiver: input.recipient,
    amount: String(chain.clause?.min_amount || '1'),
    nowMin: deps.nowMin ?? 0,
    sealed: chain.sealed,
  });
  if (!gate.ok) return { ok: false, reason: gate.reason, depositAddress: null, status: null };

  const list = await (deps.tokens || tokens)();
  const from = findToken(list, input.from);
  const to = findToken(list, input.to);
  if (to?.blockchain === 'near' && !isNearRecipient(input.recipient)) {
    return { ok: false, reason: 'near_recipient', depositAddress: null, status: null };
  }
  const built = invoiceQuoteBody({ from, to, usd: input.usd, recipient: input.recipient, refundTo: input.refundTo });
  if (!built.ok) return { ok: false, reason: built.reason, depositAddress: null, status: null };
  const sent = { ...built.body, dry: false };
  const post = deps.postQuote || postQuote;
  const res = await post(sent);
  if (res.http !== 201) return { ok: false, reason: 'quote_refused', depositAddress: null, status: null, error: res.body?.message || `HTTP ${res.http}` };
  const verify = deps.verify || defaultVerify;
  const checks = checkLiveQuote(sent, res.body, verify);
  if (!checks.accepted) {
    const reason = checks.usd?.ok ? 'quote_refused' : 'over_checkout_cap';
    return { ok: false, reason, depositAddress: null, status: null, checks: { signature: checks.signature, echo: checks.echo?.ok, usd: checks.usd?.ok } };
  }
  const usd = String(res.body.quote?.amountInUsd || input.usd);
  if (!checkoutUsdOk(usd).ok) return { ok: false, reason: 'over_checkout_cap', depositAddress: null, status: null };
  const row = {
    depositAddress: checks.depositAddress,
    depositMemo: res.body.quote?.depositMemo || null,
    recipient: input.recipient,
    charter: input.charter || input.recipient,
    usd,
    status: 'PENDING_DEPOSIT',
    tx: null,
    correlationId: res.body.correlationId || null,
  };
  (deps.remember || rememberCheckout)(row);
  return {
    ok: true,
    reason: null,
    dry: false,
    depositAddress: row.depositAddress,
    depositMemo: row.depositMemo,
    status: 'PENDING_DEPOSIT',
    help: statusHelp('PENDING_DEPOSIT'),
    usd: row.usd,
    delivered: false,
    correlationId: row.correlationId,
  };
}

export async function invoiceStatus(depositAddress, deps = {}) {
  const st = await (deps.oneClickStatus || oneClickStatus)(depositAddress);
  return { ...st, delivered: invoiceDelivered(st.status), help: st.help || invoiceStatusLine(st.status) };
}
