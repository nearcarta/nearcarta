// Durable payout invoices. EXACT_OUTPUT only. This file does not sign and does not send the deposit.
// The receive account and the amount are fixed when the invoice is created. A payer query cannot move them.
// A second checkout returns the same deposit address. ANY_INPUT is not requested.
// https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart
// https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types
// https://github.com/near/NEPs/blob/master/neps/nep-0141.md
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  hostedCeiling, aboveHosted, canonicalInvoice, invoiceRecordId, publicInvoice, invoiceExpired,
  invoiceQuoteBody, invoiceDelivered, invoiceStatusLine, addressOk, registrationVerdict,
  USDC_NEAR_CONTRACT, USDC_CONTRACT_FALLBACK, nearFromYocto, quoteSummary, bridgeMinimumHint,
  paymentLinks, receiptLine,
} from '../../app/src/panels/payouts-plan.js';
import { nearAccountOk } from '../../app/design/D8_shops/js/payouts.js';
import { tokenRef, findToken, tokens, postQuote, checkQuote, statusHelp, validDepositAddress } from './ferry.js';
import { fetchOneClickStatus, defaultVerify } from './ferry-checkout.js';
import { echoGuard } from './ferry-guard.js';

export { invoiceDelivered, invoiceStatusLine, hostedCeiling, registrationVerdict, USDC_NEAR_CONTRACT };

/** Live quote check for an invoice. Signature, echo and deposit address. No product USD cap. */
export function checkPayoutQuote(sent, resp, verify) {
  let signature = false;
  try { signature = !!verify(resp); } catch { signature = false; }
  const echo = echoGuard(sent, resp?.quoteRequest);
  const addr = resp?.quote?.depositAddress;
  const dryOff = sent?.dry === false && resp?.quoteRequest?.dry === false;
  const deposit = validDepositAddress(addr);
  const accepted = signature && echo.ok && dryOff && deposit;
  return { signature, echo, dry: dryOff, deposit, accepted, depositAddress: accepted ? addr : null };
}

const MEMORY = { byId: new Map() };
const DURABILITY = 'This API reloads the invoice file on the host. A new host starts empty. This is not a chain record.';

function filePath(env = process.env) {
  const p = env.PAYOUTS_INVOICE_FILE;
  return p && String(p).trim() ? String(p) : '';
}

function loadFile(store, path) {
  if (!path || store.loaded) return;
  store.loaded = true;
  try {
    const rows = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(rows)) for (const row of rows) if (row?.id) store.byId.set(row.id, row);
  } catch { /* a missing file means an empty book */ }
}

function saveFile(store, path) {
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify([...store.byId.values()]));
  } catch { /* the memory copy still serves this process */ }
}

export function invoiceBook(deps = {}) {
  const store = deps.store || MEMORY;
  loadFile(store, deps.file ?? filePath(deps.env || process.env));
  return store;
}

export function resetInvoices(store = MEMORY) {
  store.byId.clear();
  store.loaded = true;
}

export function invoiceInput(b) {
  if (!b || typeof b !== 'object') return { error: 'body must be a JSON object' };
  const canon = canonicalInvoice({ usd: b.usd ?? b.amount, receive: b.receive || b.recipient, memo: b.memo, due: b.due, expiry: b.expiry });
  if (!canon.ok) return { error: canon.reason };
  return { ok: true, value: canon.value };
}

/** Create or return the invoice. No 1Click call. A quote is not a payment. */
export function createInvoice(input, deps = {}) {
  const canon = canonicalInvoice(input || {});
  if (!canon.ok) return { ok: false, reason: canon.reason, depositAddress: null, invoice: null };
  const ceiling = deps.ceiling || hostedCeiling(deps.env || process.env);
  if (aboveHosted(canon.value.usd, ceiling)) {
    return { ok: false, reason: 'hosted_abuse_ceiling', depositAddress: null, invoice: null, ceiling, dry: true };
  }
  const store = invoiceBook(deps);
  const id = invoiceRecordId(canon.value);
  const existing = store.byId.get(id);
  if (existing) return { ok: true, replayed: true, invoice: publicInvoice(existing), depositAddress: existing.depositAddress || null, durability: DURABILITY };
  const row = { ...canon.value, id, status: 'UNPAID', depositAddress: null, createdAt: deps.now || Date.now() };
  store.byId.set(id, row);
  saveFile(store, deps.file ?? filePath(deps.env || process.env));
  return { ok: true, replayed: false, invoice: publicInvoice(row), depositAddress: null, durability: DURABILITY };
}

/** Read the stored invoice. Query overrides are listed and ignored. */
export function readInvoice(id, query = {}, deps = {}) {
  const store = invoiceBook(deps);
  const row = store.byId.get(String(id || ''));
  if (!row) return { ok: false, reason: 'unknown_invoice', invoice: null };
  return { ok: true, invoice: publicInvoice(row, query), durability: DURABILITY };
}

export function payerInput(b) {
  if (!b || typeof b !== 'object') return { error: 'body must be a JSON object' };
  const from = tokenRef(b.from || 'USDC@base');
  if (!from) return { error: 'missing or bad from' };
  const chain = String(b.chain || from.chain || 'base');
  if (!addressOk(chain, b.refundTo)) return { error: 'bad refundTo' };
  if (b.recipientType != null && b.recipientType !== 'DESTINATION_CHAIN') return { error: 'recipientType is fixed' };
  return { ok: true, value: { from, chain, refundTo: b.refundTo } };
}

/**
 * Payer checkout. The stored receive account is the recipient.
 * A body recipient, even a different one, is ignored.
 * A second call does not ask 1Click again.
 */
export async function checkoutInvoice(id, payer, deps = {}) {
  const store = invoiceBook(deps);
  const row = store.byId.get(String(id || ''));
  if (!row) return { ok: false, reason: 'unknown_invoice', depositAddress: null, delivered: false };
  if (invoiceDelivered(row.status)) {
    return { ok: true, replayed: true, delivered: true, status: 'SUCCESS', depositAddress: row.depositAddress, invoice: publicInvoice(row) };
  }
  if (row.depositAddress) {
    return { ok: true, replayed: true, delivered: false, status: row.status, depositAddress: row.depositAddress, invoice: publicInvoice(row) };
  }
  if (invoiceExpired(row, deps.now || Date.now())) {
    return { ok: false, reason: 'expired', depositAddress: null, delivered: false, status: row.status };
  }
  const ceiling = deps.ceiling || hostedCeiling(deps.env || process.env);
  if (aboveHosted(row.usd, ceiling)) {
    return { ok: false, reason: 'hosted_abuse_ceiling', depositAddress: null, delivered: false, ceiling };
  }
  const list = await (deps.tokens || tokens)();
  const from = findToken(list, payer.from);
  const to = findToken(list, 'USDC@near');
  const built = invoiceQuoteBody({
    from, to, usd: row.usd, recipient: row.receive, refundTo: payer.refundTo, ceiling,
  });
  if (!built.ok) return { ok: false, reason: built.reason, depositAddress: null, delivered: false };
  const sent = { ...built.body, dry: false };
  const post = deps.postQuote || postQuote;
  const res = await post(sent);
  if (res.http !== 201) return { ok: false, reason: 'quote_refused', depositAddress: null, delivered: false, error: res.body?.message || `HTTP ${res.http}` };
  const verify = deps.verify || defaultVerify;
  const checks = (deps.checkPayoutQuote || checkPayoutQuote)(sent, res.body, verify);
  if (!checks.accepted || !checks.depositAddress) {
    return { ok: false, reason: 'quote_refused', depositAddress: null, delivered: false };
  }
  if (String(res.body.quoteRequest?.recipient) !== row.receive) {
    return { ok: false, reason: 'recipient_moved', depositAddress: null, delivered: false };
  }
  row.depositAddress = checks.depositAddress;
  row.status = 'PENDING_DEPOSIT';
  row.refundTo = payer.refundTo;
  row.payChain = payer.chain || '';
  store.byId.set(row.id, row);
  saveFile(store, deps.file ?? filePath(deps.env || process.env));
  return {
    ok: true,
    replayed: false,
    delivered: false,
    dry: false,
    depositAddress: row.depositAddress,
    status: 'PENDING_DEPOSIT',
    help: statusHelp('PENDING_DEPOSIT'),
    invoice: publicInvoice(row),
  };
}

/** Dry quote for a stored amount. depositAddress stays null. A hosted ceiling, when set, returns first. */
export async function quoteInvoice(input, deps = {}) {
  const ceiling = deps.ceiling || hostedCeiling(deps.env || process.env);
  if (aboveHosted(input.usd, ceiling)) {
    return { ok: false, reason: 'hosted_abuse_ceiling', dry: true, depositAddress: null, status: null, ceiling };
  }
  const list = await (deps.tokens || tokens)();
  const from = findToken(list, input.from);
  const to = findToken(list, input.to || 'USDC@near');
  const built = invoiceQuoteBody({ from, to, usd: input.usd, recipient: input.recipient || input.receive, refundTo: input.refundTo, ceiling });
  if (!built.ok) return { ok: false, reason: built.reason, dry: true, depositAddress: null, status: null };
  const post = deps.postQuote || postQuote;
  const res = await post(built.body);
  if (res.http !== 201) {
    return {
      ok: false, reason: 'quote_refused', dry: true, depositAddress: null, status: null,
      error: bridgeMinimumHint(res.body?.message || `HTTP ${res.http}`),
    };
  }
  const checks = (deps.checkQuote || checkQuote)(built.body, res.body);
  return {
    ok: !!checks.accepted,
    reason: checks.accepted ? null : 'quote_refused',
    dry: true,
    depositAddress: null,
    status: 'quoted',
    swapType: 'EXACT_OUTPUT',
    help: 'Dry quote. No deposit address. Nothing was sent.',
    ...quoteSummary(res.body),
  };
}

/** Dry quote for a stored invoice. The payer cannot move the receive account or the amount. */
export async function quoteStored(id, payer, deps = {}) {
  const store = invoiceBook(deps);
  const row = store.byId.get(String(id || ''));
  if (!row) return { ok: false, reason: 'unknown_invoice', depositAddress: null };
  if (invoiceExpired(row, deps.now || Date.now())) return { ok: false, reason: 'expired', depositAddress: null };
  const out = await quoteInvoice({
    usd: row.usd, from: payer.from, to: 'USDC@near', recipient: row.receive, refundTo: payer.refundTo,
  }, deps);
  return { ...out, invoice: publicInvoice(row), depositAddress: null };
}

export async function refreshInvoice(id, deps = {}) {
  const store = invoiceBook(deps);
  const row = store.byId.get(String(id || ''));
  if (!row) return { ok: false, reason: 'unknown_invoice', delivered: false };
  if (!row.depositAddress) return { ok: true, invoice: publicInvoice(row), delivered: false, status: row.status };
  const st = await (deps.oneClickStatus || fetchOneClickStatus)(row.depositAddress);
  if (st?.status) row.status = st.status;
  store.byId.set(row.id, row);
  saveFile(store, deps.file ?? filePath(deps.env || process.env));
  const view = publicInvoice(row);
  const links = paymentLinks({
    destinationTx: st?.destinationTx, nearTx: st?.nearTx, originTx: st?.originTx, chain: row.payChain,
  });
  return {
    ...st, ...view, links, receipt: receiptLine(view, row.status),
    delivered: invoiceDelivered(row.status), help: st?.help || invoiceStatusLine(row.status),
  };
}

/**
 * storage_balance_of on native USDC. Args stay JSON { account_id }, base64 inside view().
 * The 64-hex contract is tried first. An account id that is too long falls through to the factory alias.
 * A view that still fails is unknown, and the invoice stays valid. A missing account is a clear error.
 */
export async function registrationOf(account, deps = {}) {
  const who = String(account || '').trim();
  if (!nearAccountOk(who)) return { ok: false, reason: 'bad_account', claim: 'bad_account', text: 'That is not a NEAR account name.' };
  if (typeof deps.viewAccount === 'function') {
    try { await deps.viewAccount(who); }
    catch (e) {
      const msg = String(e?.message || '');
      if (/UNKNOWN_ACCOUNT|does not exist/i.test(msg)) {
        return { ok: false, account: who, reason: 'missing_account', claim: 'missing', text: `${who} does not exist on NEAR. Check the name before anyone pays.` };
      }
    }
  }
  const view = deps.view;
  if (!view) return { ok: true, account: who, ...registrationVerdict(null, { error: 'no view' }) };
  const contracts = deps.contracts || [deps.contract || USDC_NEAR_CONTRACT, USDC_CONTRACT_FALLBACK].filter((id, i, all) => id && all.indexOf(id) === i);
  let last = 'unread';
  for (const contract of contracts) {
    try {
      const balance = await view(contract, 'storage_balance_of', { account_id: who });
      let minNear;
      try {
        const bounds = await view(contract, 'storage_balance_bounds', {});
        minNear = nearFromYocto(bounds?.min);
      } catch { /* the calm line still names who pays */ }
      return { ok: true, account: who, contract, ...registrationVerdict(balance, { minNear: minNear || undefined }) };
    } catch (e) {
      last = e?.message || last;
    }
  }
  return { ok: true, account: who, ...registrationVerdict(null, { error: last }) };
}
