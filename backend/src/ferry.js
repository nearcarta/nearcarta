// Ferry: cross-chain swap quotes through NEAR Intents 1Click. quote() is always dry:true, so that
// path creates no deposit address and spends nothing. A checkout that may ask for a deposit address
// lives in ferry-checkout.js and runs only after the charter view allows it. Every quote is checked:
//  1. the 1Click manager signature (ed25519 over base58(sha256(stable JSON)))
//  2. the echo guard: every field we asked for must come back unchanged in quoteRequest.
//     confidentiality, appFees and rebates are NOT covered by the signature, so a quote whose echo
//     differs from our request (for example a silent downgrade from basic to public) is rejected.
//  3. for ZEC, the recipient must be an Orchard-only UA (decoded from the address itself);
//     Orchard+Sapling and Orchard+transparent are refused before 1Click is asked.
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { KeyPair } from 'near-api-js';
import { cfg, secret, DEP, MAINNET_DEP } from './config.js';
const QUOTE_SIGNER = DEP.ferry?.quote_signer || MAINNET_DEP?.ferry?.quote_signer || 'ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc';
import { zcashRecipient } from './zcash.js';
import { echoGuard, orchardOnly } from './ferry-guard.js';

const UA = { 'User-Agent': 'nearcarta-ferry/0.1 (+curl/8.5.0)', 'content-type': 'application/json' };
let tokenCache = { at: 0, list: null };

export async function tokens() {
  if (tokenCache.list && Date.now() - tokenCache.at < 5 * 60e3) return tokenCache.list;
  const r = await fetch(`${cfg.oneClick}/v0/tokens`, { headers: UA });
  if (!r.ok) throw new Error(`1click tokens http ${r.status}`);
  const raw = await r.json();
  // Drop upstream entries with a missing or non-string field, so no lookup can call a string method on undefined.
  const list = (Array.isArray(raw) ? raw : []).filter(validToken);
  tokenCache = { at: Date.now(), list };
  return list;
}

// A token reference from a client: {symbol, chain}, {assetId}, 'USDC@base', 'USDC:base' or a raw
// 1Click asset id ('nep141:…', 'nep245:…'). Returns {symbol, chain} or {assetId}, or null if malformed.
const SYM = /^[A-Za-z0-9.$_-]{1,20}$/, CHAIN = /^[a-z0-9_-]{1,20}$/, ASSET = /^nep(141|245):[\w.:@-]{1,200}$/;
export function tokenRef(v) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (ASSET.test(s)) return { assetId: s };
    const m = s.match(/^([^@:]+)[@:]([^@:]+)$/);
    return m ? tokenRef({ symbol: m[1], chain: m[2].toLowerCase() }) : null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (v.assetId !== undefined) return typeof v.assetId === 'string' && ASSET.test(v.assetId) ? { assetId: v.assetId } : null;
  const chain = typeof v.chain === 'string' ? v.chain.toLowerCase() : v.chain;
  return typeof v.symbol === 'string' && SYM.test(v.symbol) && typeof chain === 'string' && CHAIN.test(chain) ? { symbol: v.symbol, chain } : null;
}

export const validToken = t => !!t && typeof t === 'object' && typeof t.assetId === 'string' && typeof t.symbol === 'string'
  && typeof t.blockchain === 'string' && Number.isInteger(t.decimals);

export function findToken(list, ref) {
  const r = tokenRef(ref); if (!r) return undefined;
  if (r.assetId) return list.find(t => t.assetId === r.assetId);
  return (list || []).filter(validToken).find(t => t.symbol.toUpperCase() === r.symbol.toUpperCase() && t.blockchain === r.chain);
}

export function toUnits(amount, decimals) {
  const [w, f = ''] = String(amount).split('.');
  if (!/^\d+$/.test(w) || !/^\d*$/.test(f)) throw Object.assign(new Error('bad amount'), { status: 400 });
  if (f.length > decimals) throw Object.assign(new Error('too many decimals'), { status: 400 });
  return (BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}

export const PRIVACY = ['public', 'basic', 'advanced'];

export function buildQuoteRequest({ from, to, amount, recipient, refundTo, privacy = 'public', slippageBps = 100, deadlineMin = 60, live = false }) {
  if (!PRIVACY.includes(privacy)) throw Object.assign(new Error('privacy must be public|basic|advanced'), { status: 400 });
  const body = {
    dry: live !== true,
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
  const signature = verifyQuoteSignature(resp, QUOTE_SIGNER);
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
    try { zec = zcashRecipient(input.recipient); } catch { throw Object.assign(new Error('recipient is not a valid Zcash address'), { status: 400 }); }
    const g = orchardOnly(zec.receivers);
    zec.orchard_only = g.ok;
    if (!g.ok) return { ok: false, refused: 'recipient_not_orchard_only', error: `Refused before quoting: ${g.why}. The Ferry pays ZEC only to an Orchard-only unified address.`, zcash: zec };
  }
  const sent = buildQuoteRequest({ ...input, from, to });
  const res = await postQuote(sent, { auth: sent.confidentiality !== undefined });
  if (res.http !== 201) return { ok: false, http: res.http, ms: res.ms, error: `1Click answered HTTP ${res.http}: ${res.body?.message || 'no message'}${res.body?.correlationId ? ' (correlation ' + res.body.correlationId + ')' : ''}`, sent: redact(sent) };
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

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const b58hex = s => { let n = 0n; for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); } return n.toString(16).padStart(64, '0'); };
// Deposit addresses: 64-hex NEAR implicit, 0x EVM, a NEAR account id, or base58 (Solana).
export const validDepositAddress = a => typeof a === 'string' && a.length <= 96 &&
  (/^[0-9a-f]{64}$/.test(a) || /^0x[0-9a-fA-F]{40}$/.test(a) || /^([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/.test(a) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a));
// What each 1Click status means for the person waiting, in plain words.
export const STATUS_HELP = {
  PENDING_DEPOSIT: 'Waiting for your deposit to arrive.',
  KNOWN_DEPOSIT_TX: 'Your deposit transaction was seen; waiting for it to confirm.',
  INCOMPLETE_DEPOSIT: 'Less than the quoted amount arrived. Send the rest to the same address before the deadline, or the amount received is refunded.',
  PROCESSING: 'Deposit received; the swap is running.',
  SUCCESS: 'Done: the output was delivered.',
  REFUNDED: 'Refunded to your refund address.',
  FAILED: 'The swap failed; see the refund line.',
};
export const statusHelp = s => STATUS_HELP[s] || `Unknown status ${String(s).slice(0, 40)}; nothing is assumed.`;
// One refund address per swap. A real swap's refundTo is a fresh NEAR implicit account (64-hex id of a
// one-time ed25519 key made for that swap only), never the wallet and never the recipient, so a refund
// cannot be linked to the payer's wallet or to any other swap. The key goes to the caller (kept in
// .secrets/, never committed); the refund lands in that account's verifier balance and only it can move it.
export const implicitId = pk => Buffer.from(pk.data).toString('hex');
export function freshRefund(used = new Set(), avoid = []) {
  for (let i = 0; i < 3; i++) {
    const kp = KeyPair.fromRandom('ed25519');
    const accountId = implicitId(kp.getPublicKey());
    if (used.has(accountId) || avoid.includes(accountId)) continue;
    used.add(accountId);
    return { accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
  }
  throw new Error('could not make a fresh refund account');
}
// Refuses a refundTo that was used before, or that equals the payer wallet or the recipient.
export function checkFreshRefund(refundTo, { used = new Set(), wallet, recipient } = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(refundTo))) return { ok: false, why: 'refundTo is not a one-time implicit account' };
  if (refundTo === wallet) return { ok: false, why: 'refundTo is the payer wallet' };
  if (refundTo === recipient) return { ok: false, why: 'refundTo is the recipient' };
  if (used.has(refundTo)) return { ok: false, why: 'refundTo was already used by another swap' };
  return { ok: true };
}

// Every pair the app offers, probed with a dry quote (sample addresses, refund on the origin chain).
// The app shows only pairs that quoted OK in the last probe; a failing pair is hidden, not offered.
export const PAIRS = [['USDC@base', '30'], ['ETH@base', '0.01'], ['USDC@near', '30'], ['ETH@eth', '0.01'], ['USDC@arb', '30']]
  .flatMap(([from, amount]) => ['ZEC@zec', 'wNEAR@near'].map(to => ({ from, to, amount })));
export const SAMPLE = { zec: 'u1naczqa5m5nefpyqnhs8h3dw8un8z8us45xwgfh4ees95mayyru9snc33dkfk2dc27r5syu4uveyyd5dt8wwad89kpc3f8cah055lm0ex',
  near: '561e8ef0fecb621469da30250dc6cdcd1e47a66e561e8ef0fecb621469da3025', evm: '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e' };
let routesMemo = null;
export async function routes({ ttlMs = 30 * 60e3 } = {}) {
  if (routesMemo && Date.now() - routesMemo.at < ttlMs) return routesMemo.v;
  const out = [];
  for (const p of PAIRS) {
    const origin = p.from.split('@')[1];
    try {
      const v = await quote({ from: tokenRef(p.from), to: tokenRef(p.to), amount: p.amount, privacy: 'public',
        recipient: p.to === 'ZEC@zec' ? SAMPLE.zec : SAMPLE.near, refundTo: origin === 'near' ? SAMPLE.near : SAMPLE.evm });
      out.push({ ...p, ok: !!v.ok, error: v.ok ? null : v.error || 'checks failed' });
    } catch (e) { out.push({ ...p, ok: false, error: e.message }); }
  }
  const v = { at: new Date().toISOString(), routes: out };
  if (out.some(r => r.ok)) routesMemo = { at: Date.now(), v };
  return v;
}
