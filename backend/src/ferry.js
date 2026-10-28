// Ferry: cross-chain swap quotes through NEAR Intents 1Click. Always dry:true here, so no deposit
// address is created and nothing can be spent. Every quote is checked before it is shown:
//  1. the 1Click manager signature (ed25519 over base58(sha256(stable JSON)))
//  2. the echo guard: every field we asked for must come back unchanged in quoteRequest.
//     confidentiality, appFees and rebates are NOT covered by the signature, so a quote whose echo
//     differs from our request (for example a silent downgrade from basic to public) is rejected.
//  3. for ZEC, the recipient must be an Orchard-only UA (decoded from the address itself);
//     Orchard+Sapling and Orchard+transparent are refused before 1Click is asked.
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { cfg, secret, DEP } from './config.js';
import { zcashRecipient } from './zcash.js';
import { echoGuard, orchardOnly } from './ferry-guard.js';

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
  if (!/^\d+$/.test(w) || !/^\d*$/.test(f)) throw Object.assign(new Error('bad amount'), { status: 400 });
  if (f.length > decimals) throw Object.assign(new Error('too many decimals'), { status: 400 });
  return (BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}

export const PRIVACY = ['public', 'basic', 'advanced'];

export function buildQuoteRequest({ from, to, amount, recipient, refundTo, privacy = 'public', slippageBps = 100, deadlineMin = 60 }) {
  if (!PRIVACY.includes(privacy)) throw Object.assign(new Error('privacy must be public|basic|advanced'), { status: 400 });
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

// The echo guard and the Orchard-only check live in ./ferry-guard.js (no deps, importable by the frontend).
export { echoGuard, orchardOnly, ferryGuard, PROTOCOL_FEE_MAX_BPS } from './ferry-guard.js';

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
  if (to.blockchain === 'zec') {
    zec = zcashRecipient(input.recipient);
    const g = orchardOnly(zec.receivers);
    zec.orchard_only = g.ok;
    if (!g.ok) return { ok: false, refused: 'recipient_not_orchard_only', error: `Refused before quoting: ${g.why}. The Ferry pays ZEC only to an Orchard-only unified address.`, zcash: zec };
  }
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
