// NEAR Intents routes for Ferry: signed intent execution and limit orders.
//
// Nothing here signs a transaction and nothing here sends a deposit. A signed intent is
// signed by the visitor's own wallet; this module only asks 1Click for the payload and
// submits what the visitor signed. Orders rest at 1Click; the visitor funds them from
// their own wallet.
//
// Docs: docs/internal/intents/. Host: https://1click.chaindefuser.com (cfg.oneClick).
import { cfg, secret } from './config.js';
import { tokenRef, findToken, tokens, buildQuoteRequest, postQuote, validDepositAddress, echoGuard } from './ferry.js';
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import {
  needsSignedIntent, confidentialityCheck, orderInput, orderView, isOpenOrder, signedIntentBody,
  statusSignature, deliveryVerdict, DEPOSIT_TYPES,
} from '../../shared/ferry/intents.js';

const UA = { 'User-Agent': 'nearcarta-ferry/0.1 (+curl/8.5.0)', 'content-type': 'application/json' };
const partnerKey = () => secret.oneClick();

/** Authenticated call. generate-intent, submit-intent and every /v0/orders call need the partner key. */
async function partnerFetch(path, { method = 'GET', body = null } = {}) {
  const key = partnerKey();
  if (!key) throw Object.assign(new Error('this needs ONECLICK_PARTNER_KEY on the server'), { status: 503, expose: true });
  const r = await fetch(`${cfg.oneClick}${path}`, {
    method,
    headers: { ...UA, 'X-API-Key': key },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json().catch(() => ({}));
  return { http: r.status, body: j };
}

/** A JSON:API error document, flattened to the code the docs say to branch on. */
export function jsonApiError(body) {
  const e = Array.isArray(body?.errors) ? body.errors[0] : null;
  return {
    code: e?.code || null,
    title: e?.title || null,
    detail: e?.detail || null,
    pointer: e?.source?.pointer || null,
    correlationId: body?.meta?.correlationId || null,
  };
}

/**
 * A quote that can be funded by a signature instead of a deposit tx. The only difference
 * from a normal quote is `depositType` (and the matching refund/recipient types), so the
 * same row checks apply.
 */
export async function signedIntentQuote(input) {
  const depositType = String(input.depositType || 'INTENTS').toUpperCase();
  if (!needsSignedIntent(depositType)) return { ok: false, error: `depositType ${depositType} is an on-chain deposit, not a signed intent`, httpStatus: 400 };
  const list = await tokens();
  const from = findToken(list, input.from), to = findToken(list, input.to);
  if (!from || !to) return { ok: false, error: 'unknown token', httpStatus: 400 };
  const conf = confidentialityCheck(input.confidentiality || 'public', { hasPartnerKey: !!secret.oneClick() });
  if (!conf.ok) return { ok: false, error: conf.reason, httpStatus: conf.reason === 'confidential_needs_partner_key' ? 503 : 400 };
  const sent = buildQuoteRequest({
    from, to, amount: input.amount, recipient: input.recipient, refundTo: input.refundTo,
    privacy: conf.level, slippageBps: Number(input.slippageBps || 100), live: true,
  });
  // The three types move together: an Intents deposit refunds and pays inside Intents.
  sent.depositType = depositType;
  sent.refundType = depositType;
  sent.recipientType = depositType === 'INTENTS' ? 'INTENTS' : 'CONFIDENTIAL_INTENTS';
  const res = await postQuote(sent, { auth: true });
  if (res.http !== 201) {
    return { ok: false, httpStatus: 502, error: `1Click answered HTTP ${res.http}: ${res.body?.message || 'no message'}`, correlationId: res.body?.correlationId || null, sent };
  }
  const sig = (() => { try { return verifyQuoteSignature(res.body); } catch { return false; } })();
  const echo = echoGuard(sent, res.body.quoteRequest);
  const q = res.body.quote || {};
  return {
    ok: sig && echo.ok && !!q.depositAddress,
    httpStatus: 200,
    route: 'signed_intent',
    depositType,
    depositAddress: q.depositAddress || null,
    depositMemo: q.depositMemo || null,
    from: { symbol: from.symbol, chain: from.blockchain, amount: q.amountInFormatted, usd: q.amountInUsd },
    to: { symbol: to.symbol, chain: to.blockchain, amount: q.amountOutFormatted, min: q.minAmountOut },
    privacy: conf.level,
    signed: sig,
    echo,
    deadline: sent.deadline,
    correlationId: res.body.correlationId || null,
    // There is no deposit tx on this route: the visitor signs instead.
    needsSignature: true,
    sent,
  };
}

/**
 * Ask 1Click for the unsigned payload for a signed-intent quote. The visitor then signs
 * `intent.payload` with their wallet; nothing here can sign it.
 */
export async function generateIntent({ depositAddress, signerId, standard = 'nep413' }) {
  if (!validDepositAddress(depositAddress)) return { ok: false, error: 'not a deposit address', httpStatus: 400 };
  if (!signerId || typeof signerId !== 'string' || signerId.length > 64) return { ok: false, error: 'bad signerId', httpStatus: 400 };
  const res = await partnerFetch('/v0/generate-intent', {
    method: 'POST',
    body: { type: 'swap_transfer', standard, signerId, depositAddress },
  });
  if (res.http !== 200) return { ok: false, httpStatus: res.http === 401 ? 503 : 502, ...jsonApiError(res.body), error: '1Click did not generate an intent' };
  return {
    ok: true, httpStatus: 200,
    intent: res.body.intent || null,
    correlationId: res.body.correlationId || null,
    // The visitor signs exactly this. Do not edit it: the signature covers these bytes.
    signThis: res.body.intent?.payload ?? null,
    standard,
  };
}

/** Submit what the visitor signed. Returns the intent hash that 1Click tracks. */
export async function submitIntent({ intent, publicKey, signature }) {
  let body;
  try { body = signedIntentBody(intent, { publicKey, signature }); }
  catch (e) { return { ok: false, error: e.message, httpStatus: 400 }; }
  const res = await partnerFetch('/v0/submit-intent', { method: 'POST', body });
  if (res.http !== 200) return { ok: false, httpStatus: res.http === 401 ? 503 : 502, ...jsonApiError(res.body), error: '1Click did not accept the signed intent' };
  return { ok: true, httpStatus: 200, intentHash: res.body.intentHash || null, correlationId: res.body.correlationId || null };
}

/**
 * Create a limit order. 1Click requires `confidentiality`, and limit orders always run as
 * confidential swaps, so this never sends `public`.
 */
export async function createOrder(input) {
  const list = await tokens();
  const base = findToken(list, input.base), quoteTok = findToken(list, input.quote);
  if (!base || !quoteTok) return { ok: false, error: 'unknown base or quote token', httpStatus: 400 };
  let body;
  try {
    body = orderInput({
      baseAsset: base.assetId, quoteAsset: quoteTok.assetId,
      quantity: input.quantity, side: input.side, price: input.price,
      baseDecimals: base.decimals, quoteDecimals: quoteTok.decimals,
      refundTo: input.refundTo, refundType: input.refundType || 'ORIGIN_CHAIN',
      recipient: input.recipient, recipientType: input.recipientType || 'ORIGIN_CHAIN',
      depositType: input.depositType || 'ORIGIN_CHAIN',
      confidentiality: input.confidentiality || 'basic',
      deadline: input.deadline || null,
    });
  } catch (e) { return { ok: false, error: e.message, httpStatus: 400 }; }
  const res = await partnerFetch('/v0/orders', { method: 'POST', body });
  if (res.http !== 201) {
    const mapped = res.http === 401 ? 503 : res.http;
    return { ok: false, httpStatus: mapped, ...jsonApiError(res.body), error: '1Click did not create the order', sent: body };
  }
  const view = orderView(res.body);
  return {
    ok: true, httpStatus: 200, order: view,
    // What the visitor must send, from the order's own swapView.
    deposit: {
      address: view.depositAddress,
      memo: res.body?.data?.attributes?.depositMemo || null,
      amount: res.body?.data?.attributes?.swapView?.amountIn || res.body?.data?.attributes?.swapView?.maxAmountIn || null,
      swapType: res.body?.data?.attributes?.swapView?.swapType || null,
    },
  };
}

/** List orders. `openOnly` keeps the fill states that are still working. */
export async function listOrders({ openOnly = true, size = 20 } = {}) {
  const qs = new URLSearchParams();
  if (openOnly) for (const s of ['AWAITING_DEPOSIT', 'OPEN', 'PARTIALLY_FILLED', 'PENDING_CANCEL']) qs.append('filter[fillStatus]', s);
  qs.set('page[size]', String(Math.min(Math.max(Number(size) || 20, 1), 50)));
  const res = await partnerFetch(`/v0/orders?${qs.toString()}`);
  if (res.http !== 200) return { ok: false, httpStatus: res.http === 401 ? 503 : 502, ...jsonApiError(res.body), error: '1Click did not list orders' };
  const rows = Array.isArray(res.body?.data) ? res.body.data : [];
  return {
    ok: true, httpStatus: 200,
    orders: rows.map(orderView),
    open: rows.filter(isOpenOrder).map(orderView),
    next: res.body?.links?.next || null,
  };
}

export async function getOrder(orderId) {
  if (!orderId || typeof orderId !== 'string' || orderId.length > 128) return { ok: false, error: 'bad order id', httpStatus: 400 };
  const res = await partnerFetch(`/v0/orders/${encodeURIComponent(orderId)}`);
  if (res.http !== 200) return { ok: false, httpStatus: res.http === 404 ? 404 : (res.http === 401 ? 503 : 502), ...jsonApiError(res.body), error: '1Click did not return the order' };
  return { ok: true, httpStatus: 200, order: orderView(res.body) };
}

/**
 * Cancel is asynchronous. The docs say matching stops, filled output is still withdrawn,
 * and the unfilled remainder is refunded; a last slice can still fill.
 */
export async function cancelOrder(orderId) {
  if (!orderId || typeof orderId !== 'string' || orderId.length > 128) return { ok: false, error: 'bad order id', httpStatus: 400 };
  const res = await partnerFetch(`/v0/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST' });
  if (res.http !== 200 && res.http !== 202) return { ok: false, httpStatus: res.http === 404 ? 404 : (res.http === 401 ? 503 : 502), ...jsonApiError(res.body), error: '1Click did not cancel the order' };
  return {
    ok: true, httpStatus: 200,
    order: res.body?.data ? orderView(res.body) : null,
    note: 'Cancel stops matching. Filled output is still withdrawn and the unfilled remainder is refunded to the refund address. A last slice can still fill, so the order may end FILLED instead of CANCELED.',
  };
}

/** Kept for tests and for the routes: the deposit channels this module speaks. */
export { DEPOSIT_TYPES, statusSignature, deliveryVerdict };
