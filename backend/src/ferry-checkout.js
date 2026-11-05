// Universal checkout. quote() in ferry.js stays dry. This file asks 1Click for a deposit address
// only after a view of the charter would allow the recipient (allowlist, per-payment cap, daily
// budget, daily count, time window, not frozen, no sealed hidden rule). The 1Click amount is
// capped at 0.20 USD. Nothing here signs a transaction or sends the deposit.
import { readFileSync } from 'node:fs';
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { cfg, DEP } from './config.js';
import { view } from './near.js';
import { tokenRef, findToken, tokens, quote, postQuote, buildQuoteRequest, echoGuard, validDepositAddress, statusHelp } from './ferry.js';
import { intentsCheckout } from '../../shared/rails/receipts.js';

export const MAX_CHECKOUT_USD = 0.2;
const FINAL = ['SUCCESS', 'REFUNDED', 'FAILED'];
const YOCTO_001 = 10n ** 21n; // 0.001 NEAR, under the town charter's 0.002 cap
const issued = new Map();

export const isNearAccount = s => typeof s === 'string' && s.length >= 2 && s.length <= 64
  && (/^[0-9a-f]{64}$/.test(s) || /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s));

export function yocto(v) {
  if (v == null) return 0n;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'object') return yocto(v.amount ?? v['0']);
  const s = String(v);
  if (!/^\d+$/.test(s)) throw new Error('bad yocto');
  return BigInt(s);
}

export function utcMinute(d = new Date()) { return d.getUTCHours() * 60 + d.getUTCMinutes(); }

export function checkoutUsdOk(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'bad_usd' };
  if (n > MAX_CHECKOUT_USD + 1e-8) return { ok: false, reason: 'over_checkout_cap' };
  return { ok: true, usd: n };
}

// Same checks as contracts/oath clause_checks plus the daily budget and the daily count.
// A sealed hidden rule is refused here: the view cannot see it, so a deposit address would
// skip a rule the charter would still enforce.
export function charterGate({ state, clause, usage, receiver, amount, nowMin, sealed = false }) {
  if (sealed) return { ok: false, reason: 'hidden_rule' };
  if (!clause) return { ok: false, reason: 'no_clause' };
  if (state?.frozen) return { ok: false, reason: 'frozen' };
  if (clause.requires_receipt) return { ok: false, reason: 'requires_receipt' };
  const receivers = clause.receivers || [];
  if (!receivers.includes(receiver)) return { ok: false, reason: 'receiver_not_allowlisted' };
  let amt;
  try { amt = yocto(amount); } catch { return { ok: false, reason: 'bad_amount' }; }
  if (amt <= 0n) return { ok: false, reason: 'zero_amount' };
  let min = 1n;
  try { min = yocto(clause.min_amount ?? '1'); } catch { return { ok: false, reason: 'bad_amount' }; }
  if (amt < min) return { ok: false, reason: 'below_min_amount' };
  let cap, budget;
  try { cap = yocto(clause.per_action_cap); budget = yocto(clause.daily_budget); }
  catch { return { ok: false, reason: 'bad_amount' }; }
  if (amt > cap) return { ok: false, reason: 'over_per_action_cap' };
  let spent = 0n;
  try { spent = yocto(usage?.spent) + yocto(usage?.reserved); }
  catch { return { ok: false, reason: 'bad_amount' }; }
  if (spent + amt > budget) return { ok: false, reason: 'over_daily_budget' };
  const max = Number(clause.max_actions_per_day ?? 50);
  if (Number(usage?.count || 0) >= max) return { ok: false, reason: 'over_daily_action_count' };
  const s = Number(clause.window_start_min ?? 0), e = Number(clause.window_end_min ?? 0);
  if (s !== e && nowMin != null) {
    const m = Number(nowMin);
    const open = s < e ? (m >= s && m < e) : (m >= s || m < e);
    if (!open) return { ok: false, reason: 'outside_time_window' };
  }
  return { ok: true, reason: null };
}

export function settlementYocto(clause, usage) {
  try {
    const cap = yocto(clause?.per_action_cap);
    const remain = yocto(clause?.daily_budget) - yocto(usage?.spent) - yocto(usage?.reserved);
    const min = yocto(clause?.min_amount ?? '1');
    const room = remain < cap ? remain : cap;
    if (room < min) return null;
    return (YOCTO_001 <= room ? YOCTO_001 : room).toString();
  } catch { return null; }
}

export function rpcFor() {
  return cfg.mainnetRpc;
}

export async function readCharterRules(account, clauseId, viewFn = view) {
  const url = rpcFor(account);
  const [state, rules] = await Promise.all([
    viewFn(account, 'get_state', {}, url),
    viewFn(account, 'get_rules', { clause_id: clauseId }, url),
  ]);
  return { state, clause: rules?.clause || null, usage: rules?.usage || null, sealed: !!rules?.hidden_rule_sealed };
}

export function checkoutInput(b) {
  if (!b || typeof b !== 'object') return { error: 'body must be a JSON object' };
  const from = tokenRef(b.from), to = tokenRef(b.to);
  if (!from) return { error: 'missing or bad from' };
  if (!to) return { error: 'missing or bad to' };
  if (!/^\d+(\.\d+)?$/.test(String(b.amount ?? ''))) return { error: 'bad amount' };
  if (!isNearAccount(b.charter)) return { error: 'bad charter' };
  if (!isNearAccount(b.recipient)) return { error: 'bad recipient' };
  if (typeof b.refundTo !== 'string' || b.refundTo.length < 2 || b.refundTo.length > 128) return { error: 'bad refundTo' };
  const clauseId = b.clause_id || b.clauseId || 'pay';
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(clauseId)) return { error: 'bad clause' };
  const amountYocto = String(b.amount_yocto || b.amountYocto || '');
  if (!/^\d{1,40}$/.test(amountYocto)) return { error: 'bad amount_yocto' };
  if (b.privacy !== undefined && b.privacy !== 'public') return { error: 'checkout is public only' };
  return { ok: true, value: { from, to, amount: String(b.amount), recipient: b.recipient, refundTo: b.refundTo, charter: b.charter, clauseId, amountYocto, privacy: 'public', slippageBps: Number(b.slippageBps || 100) } };
}

function refused(reason, extra = {}) {
  const receipt = intentsCheckout({ decision: 'refused', reason, to: extra.recipient || null, amount: extra.usd ?? null, asset: 'USD', tx: null });
  return { ok: false, step: extra.step || 'charter', reason, depositAddress: null, receipt, ...extra, usd: extra.usd ?? null };
}

export function checkLiveQuote(sent, resp, verify) {
  let signature = false;
  try { signature = !!verify(resp); } catch { signature = false; }
  const echo = echoGuard(sent, resp?.quoteRequest);
  const addr = resp?.quote?.depositAddress;
  const usd = checkoutUsdOk(resp?.quote?.amountInUsd);
  const dryOff = sent?.dry === false && resp?.quoteRequest?.dry === false;
  const deposit = validDepositAddress(addr);
  const accepted = signature && echo.ok && usd.ok && dryOff && deposit;
  return { signature, echo, usd, dry: dryOff, deposit, accepted, depositAddress: accepted ? addr : null };
}

export function resetCheckouts() { issued.clear(); }

export function rememberCheckout(row) {
  issued.set(row.depositAddress, row);
  while (issued.size > 200) issued.delete(issued.keys().next().value);
}

export function issuedCheckout(addr) { return issued.get(addr) || null; }

function savedCheckout() {
  try {
    const j = JSON.parse(readFileSync(new URL('../../judges/proofs/ferry-checkout.json', import.meta.url), 'utf8'));
    return j && typeof j.depositAddress === 'string' ? j : null;
  } catch { return null; }
}

export function listCheckoutReceipts() {
  const rows = [...issued.values()];
  const saved = savedCheckout();
  if (saved && !issued.has(saved.depositAddress)) rows.push(saved);
  return rows.filter(r => r.depositAddress).map(r => ({
    what: r.status === 'SUCCESS' ? 'checkout settled' : 'checkout deposit address',
    to: r.recipient, amount: r.usd, asset: 'USD', decision: 'allowed', reason: null,
    tx: r.tx || r.depositAddress,
  }));
}

export async function openCheckout(input, deps) {
  let chain;
  try { chain = await deps.readCharter(input.charter, input.clauseId); }
  catch (e) { return refused('charter_unread', { step: 'charter', error: e.message, recipient: input.recipient }); }
  const gate = charterGate({ state: chain.state, clause: chain.clause, usage: chain.usage, receiver: input.recipient, amount: input.amountYocto, nowMin: utcMinute(), sealed: chain.sealed });
  if (!gate.ok) return refused(gate.reason, { step: 'charter', recipient: input.recipient });

  const list = await deps.tokens();
  const fromTok = findToken(list, input.from);
  // A known token price well over the cap refuses before 1Click. The signed amountInUsd is the hard cap.
  if (fromTok && Number(fromTok.price) > 0) {
    const rough = Number(input.amount) * Number(fromTok.price);
    if (Number.isFinite(rough) && rough > MAX_CHECKOUT_USD * 1.05 + 1e-8) return refused('over_checkout_cap', { step: 'cap', recipient: input.recipient });
  }

  const dry = await deps.quote({ ...input, from: input.from, to: input.to });
  if (!dry?.ok) return { ok: false, step: 'quote', error: dry?.error || 'quote refused', depositAddress: null, reason: 'quote_refused', receipt: intentsCheckout({ decision: 'refused', reason: 'quote_refused', to: input.recipient, tx: null }) };
  const usd = checkoutUsdOk(dry.from?.usd);
  if (!usd.ok) return refused(usd.reason, { step: 'cap', recipient: input.recipient, usd: dry.from?.usd ?? null });

  const from = findToken(list, input.from), to = findToken(list, input.to);
  if (!from || !to) return { ok: false, step: 'quote', error: 'unknown token', depositAddress: null, status: 400 };
  const sent = buildQuoteRequest({ ...input, from, to, live: true });
  const res = await deps.postQuote(sent);
  if (res.http !== 201) return { ok: false, step: 'live', error: `1Click answered HTTP ${res.http}`, depositAddress: null, receipt: intentsCheckout({ decision: 'refused', reason: 'quote_refused', to: input.recipient, amount: usd.usd, tx: null }) };
  const verify = deps.verify || (() => false);
  const checks = checkLiveQuote(sent, res.body, verify);
  if (!checks.accepted) return { ok: false, step: 'live', error: 'live quote refused', depositAddress: null, checks: { signature: checks.signature, echo: checks.echo.ok, usd: checks.usd.ok }, receipt: intentsCheckout({ decision: 'refused', reason: checks.usd.ok ? 'quote_refused' : 'over_checkout_cap', to: input.recipient, amount: res.body?.quote?.amountInUsd, tx: null }) };
  const row = {
    depositAddress: checks.depositAddress,
    depositMemo: res.body.quote?.depositMemo || null,
    recipient: input.recipient,
    charter: input.charter,
    clauseId: input.clauseId,
    usd: String(res.body.quote.amountInUsd),
    status: 'PENDING_DEPOSIT',
    tx: null,
    correlationId: res.body.correlationId || null,
  };
  rememberCheckout(row);
  const receipt = intentsCheckout({ what: 'checkout deposit address', to: input.recipient, amount: row.usd, asset: 'USD', decision: 'allowed', tx: row.depositAddress });
  return {
    ok: true, step: 'deposit', depositAddress: row.depositAddress, depositMemo: row.depositMemo,
    status: 'PENDING_DEPOSIT', help: statusHelp('PENDING_DEPOSIT'), deadline: res.body.quote?.deadline || sent.deadline,
    usd: row.usd, correlationId: row.correlationId, charter: { ok: true }, receipt,
  };
}

export async function fetchOneClickStatus(depositAddress, f = fetch) {
  if (!validDepositAddress(depositAddress)) throw Object.assign(new Error('not a deposit address'), { status: 400 });
  const r = await f(`${cfg.oneClick}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, { headers: { 'User-Agent': 'nearcarta-ferry/0.1 (+curl/8.5.0)' } });
  if (r.status === 404) throw Object.assign(new Error('unknown deposit address'), { status: 404 });
  if (!r.ok) throw Object.assign(new Error(`1click status http ${r.status}`), { status: 502 });
  const j = await r.json();
  const d = j.swapDetails || {};
  const hashes = [...(d.destinationChainTxHashes || []), ...(d.originChainTxHashes || []), ...(d.nearTxHashes || [])]
    .map(h => (typeof h === 'string' ? h : h?.hash)).filter(h => typeof h === 'string' && h.length > 0);
  return { env: 'ONECLICK', depositAddress, status: j.status, help: statusHelp(j.status), final: FINAL.includes(j.status), tx: hashes[0] || null, updatedAt: j.updatedAt || null };
}

export async function oneClickStatus(depositAddress, f = fetch) {
  const known = issuedCheckout(depositAddress) || (savedCheckout()?.depositAddress === depositAddress ? savedCheckout() : null);
  if (!known) throw Object.assign(new Error('unknown checkout'), { status: 404 });
  const st = await fetchOneClickStatus(depositAddress, f);
  if (issued.has(depositAddress)) {
    const row = issued.get(depositAddress);
    row.status = st.status;
    if (st.tx) row.tx = st.tx;
  }
  return st;
}

// The route uses these. Tests replace them and restore them.
export function defaultVerify(resp) {
  try { return verifyQuoteSignature(resp, DEP.ferry?.quote_signer); } catch { return false; }
}

export const checkoutDeps = {
  quote: input => quote(input),
  tokens: () => tokens(),
  postQuote: body => postQuote(body),
  readCharter: (account, clauseId) => readCharterRules(account, clauseId),
  verify: null,
};

export async function rulesFor(charter, clauseId = 'pay') {
  if (!isNearAccount(charter)) return { ok: false, error: 'bad charter', httpStatus: 400 };
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(clauseId)) return { ok: false, error: 'bad clause', httpStatus: 400 };
  let chain;
  try { chain = await checkoutDeps.readCharter(charter, clauseId); }
  catch (e) { return { ok: false, reason: 'charter_unread', error: e.message, httpStatus: 502 }; }
  const amount = settlementYocto(chain.clause, chain.usage);
  const gate = charterGate({ state: chain.state, clause: chain.clause, usage: chain.usage, receiver: chain.clause?.receivers?.[0], amount: amount || '1', nowMin: utcMinute(), sealed: chain.sealed });
  return {
    ok: gate.ok && !!amount, reason: gate.ok ? (amount ? null : 'over_daily_budget') : gate.reason,
    charter, clause_id: clauseId, receivers: chain.clause?.receivers || [],
    settlement_yocto: amount, frozen: !!chain.state?.frozen, httpStatus: 200,
  };
}

export async function startCheckout(body) {
  const parsed = checkoutInput(body);
  if (parsed.error) return { ok: false, error: parsed.error, httpStatus: 400, depositAddress: null };
  const out = await openCheckout(parsed.value, {
    quote: input => checkoutDeps.quote(input),
    tokens: () => checkoutDeps.tokens(),
    postQuote: body2 => checkoutDeps.postQuote(body2),
    readCharter: (a, c) => checkoutDeps.readCharter(a, c),
    verify: checkoutDeps.verify || defaultVerify,
  });
  return { ...out, httpStatus: 200 };
}
