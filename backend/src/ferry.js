// Ferry: cross-chain swap quotes through NEAR Intents 1Click. Always dry:true here, so no deposit
// address is created and nothing can be spent. Every quote is checked before it is shown:
//  1. the 1Click manager signature (ed25519 over base58(sha256(stable JSON)))
//  2. the echo guard: every field we asked for must come back unchanged in quoteRequest.
//     confidentiality, appFees and rebates are NOT covered by the signature, so a quote whose echo
//     differs from our request (for example a silent downgrade from basic to public) is rejected.
//  3. for ZEC, the recipient kind (transparent vs shielded) from the address itself.
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { cfg, secret, DEP } from './config.js';
import { zcashRecipient } from './zcash.js';

const UA = { 'User-Agent': 'nearcarta-ferry/0.1 (+curl/8.5.0)', 'content-type': 'application/json' };
let tokenCache = { at: 0, list: null };

export async function tokens() {
  if (tokenCache.list && Date.now() - tokenCache.at < 5 * 60e3) return tokenCache.list;
  const r = await fetch(`${cfg.oneClick}/v0/tokens`, { headers: UA });
  if (!r.ok) throw new Error(`1click tokens http ${r.status}`);
  const list = await r.json();
  tokenCache = { at: Date.now(), list };
  return list;
}

export function findToken(list, { symbol, chain, assetId }) {
  if (assetId) return list.find(t => t.assetId === assetId);
  return list.find(t => t.symbol.toUpperCase() === symbol.toUpperCase() && t.blockchain === chain);
}

export function toUnits(amount, decimals) {
  const [w, f = ''] = String(amount).split('.');
  if (!/^\d+$/.test(w) || !/^\d*$/.test(f)) throw new Error('bad amount');
  if (f.length > decimals) throw new Error('too many decimals');
  return (BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}

export const PRIVACY = ['public', 'basic', 'advanced'];

export function buildQuoteRequest({ from, to, amount, recipient, refundTo, privacy = 'public', slippageBps = 100, deadlineMin = 60 }) {
  if (!PRIVACY.includes(privacy)) throw new Error('privacy must be public|basic|advanced');
  const body = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: slippageBps,
    originAsset: from.assetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: to.assetId,
    amount: toUnits(amount, from.decimals),
    refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + deadlineMin * 60e3).toISOString(),
  };
  if (privacy !== 'public') body.confidentiality = privacy;
  return body;
}

// Fields that must echo back exactly. confidentiality is compared as "public" when absent.
const ECHO = ['dry', 'swapType', 'slippageTolerance', 'originAsset', 'depositType', 'destinationAsset', 'amount',
  'refundTo', 'refundType', 'recipient', 'recipientType', 'confidentiality', 'rebates'];
const norm = (k, v) => (k === 'confidentiality' ? v || 'public' : k === 'rebates' ? JSON.stringify(v || []) : v);
// 1Click appends its own protocol fee to appFees (seen live: 20 bps, 1 bp on stable routes).
// Our own fee entries must come back unchanged; extra entries are disclosed and capped.
export const PROTOCOL_FEE_MAX_BPS = 20;

export function echoGuard(sent, quoteRequest) {
  const diffs = [];
  for (const k of ECHO) {
    const a = norm(k, sent[k]), b = norm(k, quoteRequest?.[k]);
    if (a !== b) diffs.push({ field: k, sent: a, got: b });
  }
  const ours = sent.appFees || [], got = [...(quoteRequest?.appFees || [])];
  for (const f of ours) {
    const i = got.findIndex(g => g.recipient === f.recipient && g.fee === f.fee);
    if (i < 0) diffs.push({ field: 'appFees', sent: f, got: null }); else got.splice(i, 1);
  }
  const protocolBps = got.reduce((s, g) => s + Number(g.fee || 0), 0);
  if (protocolBps > PROTOCOL_FEE_MAX_BPS) diffs.push({ field: 'appFees', sent: `protocol <= ${PROTOCOL_FEE_MAX_BPS} bps`, got: `${protocolBps} bps` });
  return { ok: diffs.length === 0, diffs, protocolFeeBps: protocolBps };
}

// Cost from SIGNED fields only (amountInUsd / amountOutUsd are covered by the signature).
export function signedCostBps(q) {
  const i = Number(q.amountInUsd), o = Number(q.amountOutUsd);
  return i > 0 ? Math.round(((i - o) / i) * 1e4) : null;
}

export function checkQuote(sent, resp) {
  const signature = verifyQuoteSignature(resp, DEP.ferry.quote_signer);
  const echo = echoGuard(sent, resp.quoteRequest);
  const noDeposit = !resp.quote?.depositAddress;
  return { signature, echo, dry: resp.quoteRequest?.dry === true && noDeposit, accepted: signature && echo.ok && noDeposit };
}

export async function postQuote(body, { auth = false } = {}) {
  const headers = { ...UA };
  if (auth) {
    const k = secret.oneClick();
    if (!k) throw Object.assign(new Error('confidential quotes need ONECLICK_PARTNER_KEY on the server'), { status: 503 });
    headers.Authorization = `Bearer ${k}`;
  }
  const t0 = Date.now();
  const r = await fetch(`${cfg.oneClick}/v0/quote`, { method: 'POST', headers, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  const j = await r.json().catch(() => ({}));
  return { http: r.status, ms, body: j };
}

export async function quote(input) {
  const list = await tokens();
  const from = findToken(list, input.from), to = findToken(list, input.to);
  if (!from || !to) throw Object.assign(new Error('unknown token'), { status: 400 });
  let zec = null;
  if (to.blockchain === 'zec') zec = zcashRecipient(input.recipient);
  const sent = buildQuoteRequest({ ...input, from, to });
  const res = await postQuote(sent, { auth: sent.confidentiality !== undefined });
  if (res.http !== 201) return { ok: false, http: res.http, ms: res.ms, error: `1Click refused the quote (${res.body?.message || 'no reason'}). Common cause: the recipient does not exist on the destination chain.`, sent: redact(sent) };
  const checks = checkQuote(sent, res.body);
  const q = res.body.quote;
  return {
    ok: checks.accepted,
    ms: res.ms,
    from: { symbol: from.symbol, chain: from.blockchain, amount: q.amountInFormatted, usd: q.amountInUsd },
    to: { symbol: to.symbol, chain: to.blockchain, amount: q.amountOutFormatted, min: q.minAmountOut, usd: q.amountOutUsd },
    eta_s: q.timeEstimate,
    cost_bps_signed: signedCostBps(q),
    privacy: sent.confidentiality || 'public',
    zcash: zec,
    checks,
    signature: res.body.signature,
    correlationId: res.body.correlationId,
    sent: redact(sent),
    echoed: res.body.quoteRequest,
  };
}

const redact = b => ({ ...b });
