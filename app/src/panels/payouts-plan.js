// Payroll review and durable invoice records for the Payouts shop. No wallet, no network.
// NEAR rows under the visitor's row cap can be proposed. An over-cap row is refused before any deposit.
// A foreign asset is held: the live board does not check that amount. It is not sent.
// Invoices are EXACT_OUTPUT. There is no product cap of 0.20 USD. A hosted abuse ceiling, when set, is config.
// ANY_INPUT is partner-only and is not used.
// https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types
// https://docs.near.org/protocol/transactions/meta-tx
// https://github.com/near/NEPs/blob/master/neps/nep-0141.md
import { nearAccountOk } from '../../design/D8_shops/js/payouts.js';

export const MISS_HINT = 'Try: Create invoice 0.15 USD, Pay reviewed rows, or Export accountant CSV.';

// Bridged USDC on NEAR. A storage_balance_of view uses this account. A failed view is "unread", not gasless.
export const USDC_NEAR_CONTRACT = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1.factory.bridge.near';

const MICRO = 10n ** 18n;
const LOCKED_QUERY = ['recipient', 'receive', 'amount', 'usd', 'refundTo', 'recipientType', 'destination'];

/** NEAR from a yocto string. Exact for whole microNEAR, which is how rule caps are stored. */
export function nearFromYocto(y) {
  try {
    const micro = BigInt(String(y)) / MICRO;
    return Number(micro) / 1e6;
  } catch {
    return null;
  }
}

/**
 * Hosted abuse ceiling from process env. Null means the visitor's amount is the invoice.
 * This is not a product price and it is not the old 0.20 USD checkout rule.
 */
export function hostedCeiling(env = {}) {
  const raw = env.PAYOUTS_USD_CEILING;
  if (raw == null || String(raw).trim() === '') {
    return { kind: 'hosted_abuse_ceiling', usd: null, disclosed: 'No hosted USD ceiling is set. The visitor chooses the invoice amount.' };
  }
  const usd = Number(raw);
  if (!Number.isFinite(usd) || usd <= 0) {
    return { kind: 'hosted_abuse_ceiling', usd: null, disclosed: 'PAYOUTS_USD_CEILING is not a positive number, so it is not applied.' };
  }
  return { kind: 'hosted_abuse_ceiling', usd, disclosed: `Hosted abuse ceiling ${usd} USD. Not a product price.` };
}

export function aboveHosted(usd, ceiling) {
  return ceiling?.usd != null && Number(usd) > Number(ceiling.usd) + 1e-8;
}

/** Chain address check. Unsupported chains are rejected, not guessed. */
export function addressOk(chain, value) {
  const c = String(chain || '').toLowerCase();
  const s = String(value || '').trim();
  if (!s || s.length > 128) return false;
  if (c === 'near') return nearAccountOk(s);
  if (c === 'base' || c === 'eth' || c === 'ethereum' || c === 'arb' || c === 'arbitrum') return /^0x[0-9a-fA-F]{40}$/.test(s);
  return false;
}

/**
 * Review a payroll. The visitor cap is the only NEAR limit. No 0.005 fallback.
 * Over the cap: refused before deposit. Foreign asset: held, not sent.
 */
export function classifyPayroll(rows, { capNear = null, max = null } = {}) {
  const src = max == null ? (rows || []) : (rows || []).slice(0, max);
  const list = [];
  for (const r of src) {
    const asset = String(r?.asset || 'NEAR').toUpperCase();
    const chain = String(r?.chain || (asset === 'NEAR' ? 'near' : '')).toLowerCase();
    const to = String(r?.to || '').trim();
    const amt = Number(r?.amt);
    if (!to) continue;
    if (asset !== 'NEAR' || chain !== 'near') {
      list.push({ to, amt, asset, chain: chain || 'unknown', action: 'held', send: false, reason: 'foreign_effect_unproved' });
      continue;
    }
    if (!nearAccountOk(to)) {
      list.push({ to, amt, asset, chain, action: 'skip', send: false, reason: 'bad_account' });
      continue;
    }
    if (!(amt > 0)) {
      list.push({ to, amt, asset, chain, action: 'skip', send: false, reason: 'bad_amount' });
      continue;
    }
    if (capNear == null || !Number.isFinite(Number(capNear))) {
      list.push({ to, amt, asset, chain, action: 'hold', send: false, reason: 'no_row' });
      continue;
    }
    if (amt > Number(capNear) + 1e-12) {
      list.push({ to, amt, asset, chain, action: 'refused', send: false, reason: 'over_per_action_cap' });
      continue;
    }
    list.push({ to, amt, asset, chain, action: 'propose', send: true, reason: '' });
  }
  return {
    rows: list,
    propose: list.filter(r => r.action === 'propose'),
    refused: list.filter(r => r.action === 'refused'),
    held: list.filter(r => r.action === 'held' || r.action === 'hold'),
    skipped: list.filter(r => r.action === 'skip'),
    blocked: !list.some(r => r.send),
  };
}

/** One settled row cannot be proposed again. The key is the row, not a clock. */
export function payrollKey(row) {
  const asset = String(row?.asset || 'NEAR').toUpperCase();
  const chain = String(row?.chain || 'near').toLowerCase();
  return [chain, asset, String(row?.to || '').trim().toLowerCase(), String(row?.amt ?? '')].join('|');
}

/** Natural-language commands. A miss returns a hint and does not spend. Amounts are not raised. */
export function agentCommand(text) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!t) return { ok: false, hint: MISS_HINT };
  if (/export/.test(t) && /csv/.test(t)) return { ok: true, kind: 'csv', hint: 'CSV ready.' };
  if (/status|overdue/.test(t)) return { ok: true, kind: 'status', hint: '' };
  const one = t.match(/(?:send|pay)\s+payout\s+(\d+)/);
  if (one) {
    const n = Number(one[1]);
    if (!Number.isInteger(n) || n < 1) return { ok: false, hint: MISS_HINT };
    return { ok: true, kind: 'pay', index: n - 1, hint: '' };
  }
  if (/(pay these|pay reviewed|send payroll|send the payroll|pay the rows|pay payroll|send these|pay all)/.test(t)) {
    return { ok: true, kind: 'pay', index: null, hint: '' };
  }
  if (/invoice/.test(t)) {
    const m = t.match(/(\d+(?:\.\d+)?)\s*(?:usd|usdc)/);
    const usd = m ? Number(m[1]) : null;
    if (!(usd > 0)) return { ok: false, hint: 'Name the invoice amount, for example 0.15 USD.' };
    const origin = /base/.test(t) ? 'USDC@base' : 'USDC@near';
    return { ok: true, kind: 'invoice', usd, origin, destination: 'USDC@near', hint: '' };
  }
  return { ok: false, hint: MISS_HINT };
}

/** Rows a pay command should review. Index is zero-based. */
export function rowsForCommand(rows, cmd) {
  const list = rows || [];
  if (!cmd || cmd.kind !== 'pay') return [];
  if (cmd.index == null) return list;
  const row = list[cmd.index];
  return row ? [row] : [];
}

function fnv(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Immutable invoice fields. The payer cannot replace these later. */
export function canonicalInvoice({ usd, receive, memo = '', due = '', expiry = '' } = {}) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'bad_usd', value: null };
  const who = String(receive || '').trim();
  if (!nearAccountOk(who)) return { ok: false, reason: 'bad_receive', value: null };
  const memoS = String(memo || '').slice(0, 140);
  const dueS = String(due || '').slice(0, 40);
  const expS = String(expiry || '').slice(0, 40);
  const rounded = Math.round(n * 1e6) / 1e6;
  return {
    ok: true,
    reason: null,
    value: { usd: rounded, receive: who, memo: memoS, due: dueS, expiry: expS, destination: 'USDC@near', asset: 'USDC' },
  };
}

/** Same invoice fields always produce the same id, so a second click does not open a second bill. */
export function invoiceRecordId(value) {
  const key = [value.usd, String(value.receive).toLowerCase(), value.memo, value.due, value.expiry].join('\n');
  return 'inv_' + fnv(key) + fnv(key.split('').reverse().join(''));
}

/** Public view. Query fields that try to move the money are ignored. */
export function publicInvoice(record, query = {}) {
  const ignored = [];
  for (const k of LOCKED_QUERY) {
    if (query[k] == null || String(query[k]) === '') continue;
    const locked = k === 'recipient' || k === 'receive' ? record.receive
      : k === 'amount' || k === 'usd' ? String(record.usd)
      : k === 'destination' ? record.destination
      : record[k];
    if (String(query[k]) !== String(locked ?? '')) ignored.push(k);
  }
  return {
    id: record.id,
    usd: record.usd,
    receive: record.receive,
    memo: record.memo || '',
    due: record.due || '',
    expiry: record.expiry || '',
    destination: 'USDC@near',
    asset: 'USDC',
    status: record.status || 'UNPAID',
    delivered: invoiceDelivered(record.status),
    depositAddress: record.depositAddress || null,
    href: '/pay/' + record.id,
    ignoredQuery: ignored,
    redirected: false,
  };
}

export function invoiceExpired(record, now = Date.now()) {
  const raw = String(record?.expiry || '').trim();
  if (!raw) return false;
  const t = Date.parse(raw);
  return Number.isFinite(t) && t <= now;
}

/**
 * EXACT_OUTPUT body. Amount is the USDC the invoice locked (destination decimals).
 * recipient is the stored receive account, never the deposit address and never a query override.
 */
export function invoiceQuoteBody({ from, to, usd, recipient, refundTo, deadlineMs = Date.now() + 60 * 60 * 1000, ceiling = null } = {}) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'bad_usd', body: null, depositAddress: null };
  if (aboveHosted(n, ceiling)) {
    return { ok: false, reason: 'hosted_abuse_ceiling', body: null, depositAddress: null, ceiling };
  }
  if (!from?.assetId || !to?.assetId) return { ok: false, reason: 'unknown_token', body: null, depositAddress: null };
  const decimals = Number(to.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return { ok: false, reason: 'bad_decimals', body: null, depositAddress: null };
  if (to.blockchain === 'near' && !nearAccountOk(recipient)) {
    return { ok: false, reason: 'near_recipient', body: null, depositAddress: null };
  }
  const chain = from.blockchain || 'base';
  if (!addressOk(chain, refundTo)) return { ok: false, reason: 'bad_refund', body: null, depositAddress: null };
  if (!recipient) return { ok: false, reason: 'bad_recipient', body: null, depositAddress: null };
  const [w, f = ''] = String(n).split('.');
  if (!/^\d+$/.test(w) || !/^\d*$/.test(f) || f.length > decimals) return { ok: false, reason: 'bad_usd', body: null, depositAddress: null };
  const amount = (BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
  return {
    ok: true,
    reason: null,
    depositAddress: null,
    body: {
      dry: true,
      swapType: 'EXACT_OUTPUT',
      slippageTolerance: 100,
      originAsset: from.assetId,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: to.assetId,
      amount,
      refundTo,
      refundType: 'ORIGIN_CHAIN',
      recipient,
      recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(deadlineMs).toISOString(),
    },
  };
}

/** 1Click status words. Delivered is SUCCESS only. */
export const INVOICE_STATUS = ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS', 'INCOMPLETE_DEPOSIT', 'REFUNDED', 'FAILED'];

export function invoiceDelivered(status) {
  return status === 'SUCCESS';
}

export function invoiceStatusLine(status) {
  const s = String(status || '');
  if (s === 'SUCCESS') return 'Paid. 1Click status is SUCCESS.';
  if (s === 'REFUNDED') return 'Refunded. Nothing else was sent.';
  if (s === 'FAILED') return 'The invoice swap failed. Nothing else was sent.';
  if (s === 'INCOMPLETE_DEPOSIT') return 'The deposit was short of the quote. Not paid.';
  if (s === 'PENDING_DEPOSIT') return 'Waiting for the deposit. Not paid yet.';
  if (s === 'KNOWN_DEPOSIT_TX' || s === 'PROCESSING') return 'The deposit was seen. Not paid yet.';
  if (s === 'UNPAID') return 'Not paid.';
  return 'No settled status yet. Not paid.';
}

/**
 * NEP-141 storage. Meta-transactions pay gas, not storage_deposit.
 * https://docs.near.org/protocol/transactions/meta-tx
 * https://github.com/near/NEPs/blob/master/neps/nep-0141.md
 */
export function registrationVerdict(viewResult, { error = null } = {}) {
  if (error) {
    return { ok: false, registered: null, claim: 'unread', text: 'Could not read USDC storage. Not claimed gasless.' };
  }
  const total = viewResult && (viewResult.total ?? viewResult.total_balance);
  if (total != null && String(total) !== '0') {
    return { ok: true, registered: true, claim: 'registered', text: 'This account can hold USDC. No extra storage deposit is due for the first receipt.' };
  }
  return {
    ok: true,
    registered: false,
    claim: 'storage_required',
    text: 'USDC on NEAR needs storage_deposit before the first tokens. A function-call key cannot attach that deposit, and a meta-transaction pays gas, not storage. This shop does not claim the solver covers it. Sponsorship is not funded.',
  };
}

/** Success cinema only when every submitted step was allowed and has a tx hash. */
export function cinemaOk(steps) {
  const list = steps || [];
  if (!list.length) return false;
  return list.every(s => s && s.decision === 'allowed' && /^[1-9A-HJ-NP-Za-km-z]{20,}$/.test(String(s.tx || '')));
}

/** Seal copy. Empty when nothing was refused, so the caller can hide the seal. */
export function sealText(steps) {
  const bad = (steps || []).find(s => s && s.decision && s.decision !== 'allowed');
  if (!bad) return '';
  const why = String(bad.reason || 'refused').slice(0, 80);
  if (bad.tx) return `Charter refused this payout: ${why}. The receipt is the refusal.`;
  return `Refused before any deposit: ${why}.`;
}

/** Accountant CSV. Paid requires a real SUCCESS or a tx. A row without either stays "not sent". */
export function accountantCsv(receipts) {
  const lines = ['source,destination,asset,amount,fee,refund,status,tx'];
  for (const r of receipts || []) {
    const tx = String(r.tx || '');
    let status = r.status || (tx ? 'sent' : 'not sent');
    const success = r.delivered === true || String(r.oneClick || r.status || '') === 'SUCCESS';
    if (/^paid$/i.test(status) && !success) status = 'not sent';
    if (success && !/^paid$/i.test(status)) status = 'paid';
    const cells = [r.source || r.from || '', r.to || r.destination || r.account || '', r.asset || '', r.amount ?? r.amt ?? '', r.fee ?? '', r.refund ?? '', status, tx];
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
