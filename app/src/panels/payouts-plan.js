// Payroll and invoice plans for the Payouts shop. No wallet, no network.
// NEAR rows are board propose calls (contracts/charter_board propose).
// An over-cap row is still submitted so the charter can refuse it on chain.
// USDC is not a NEAR transfer. Invoices use 1Click EXACT_OUTPUT, at most 0.20 USD.
// ANY_INPUT is partner-only and is not used.
// https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types
// https://docs.near.org/protocol/accounts-contracts/access-keys
import { nearAccountOk } from '../../design/D8_shops/js/payouts.js';

export const CHECKOUT_USD = 0.2;
export const MISS_HINT = 'Try: Pay these three, Send payout 1, Create invoice 0.15 USD on Base USDC, or Export accountant CSV.';

const MICRO = 10n ** 18n;

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
 * Split a payroll list. `capNear` null means the row was not read: do not guess a send.
 * @returns {{rows:object[], propose:object[], chainRefuse:object[], invoices:object[], skipped:object[], blocked:boolean}}
 */
export function classifyPayroll(rows, { capNear = null, max = 3 } = {}) {
  const list = [];
  for (const r of (rows || []).slice(0, max)) {
    const asset = String(r?.asset || 'NEAR').toUpperCase() === 'USDC' ? 'USDC' : 'NEAR';
    const to = String(r?.to || '').trim();
    const amt = Number(r?.amt);
    if (!to) continue;
    if (asset === 'USDC') {
      list.push({ to, amt, asset, action: 'invoice', send: false, reason: 'usdc_not_a_near_transfer' });
      continue;
    }
    if (!nearAccountOk(to)) {
      list.push({ to, amt, asset, action: 'skip', send: false, reason: 'bad_account' });
      continue;
    }
    if (!(amt > 0)) {
      list.push({ to, amt, asset, action: 'skip', send: false, reason: 'bad_amount' });
      continue;
    }
    if (capNear == null) {
      list.push({ to, amt, asset, action: 'hold', send: false, reason: 'no_row' });
      continue;
    }
    if (amt > Number(capNear) + 1e-12) {
      list.push({ to, amt, asset, action: 'chain_refuse', send: true, reason: 'over_per_action_cap' });
      continue;
    }
    list.push({ to, amt, asset, action: 'propose', send: true, reason: '' });
  }
  return {
    rows: list,
    propose: list.filter(r => r.action === 'propose'),
    chainRefuse: list.filter(r => r.action === 'chain_refuse'),
    invoices: list.filter(r => r.action === 'invoice'),
    skipped: list.filter(r => r.action === 'skip' || r.action === 'hold'),
    blocked: !list.some(r => r.send),
  };
}

/** Natural-language commands. A miss returns a hint and does not spend. */
export function agentCommand(text) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!t) return { ok: false, hint: MISS_HINT };
  if (/export/.test(t) && /csv/.test(t)) return { ok: true, kind: 'csv', hint: 'CSV ready.' };
  if (/prepare/.test(t) && /payroll|batch|payout/.test(t)) return { ok: true, kind: 'prepare', hint: 'Prepared. Nothing was sent.' };
  const one = t.match(/(?:send|pay)\s+payout\s+(\d+)/);
  if (one) {
    const n = Number(one[1]);
    if (!Number.isInteger(n) || n < 1) return { ok: false, hint: MISS_HINT };
    return { ok: true, kind: 'pay', index: n - 1, hint: '' };
  }
  if (/(pay these|send payroll|send the payroll|pay the rows|pay payroll|send these|pay all)/.test(t)) {
    return { ok: true, kind: 'pay', index: null, hint: '' };
  }
  if (/invoice/.test(t)) {
    const m = t.match(/(\d+(?:\.\d+)?)\s*(?:usd|usdc)/);
    const usd = m ? Number(m[1]) : null;
    if (!(usd > 0)) return { ok: false, hint: 'Name the invoice amount, for example 0.15 USD.' };
    if (usd > CHECKOUT_USD + 1e-8) {
      return { ok: false, kind: 'invoice', reason: 'over_checkout_cap', usd, hint: `${usd} USD is over the 0.20 USD cap. No deposit address was requested.` };
    }
    const origin = /base/.test(t) ? 'USDC@base' : 'USDC@near';
    return { ok: true, kind: 'invoice', usd, origin, destination: 'USDC@near', hint: '' };
  }
  return { ok: false, hint: MISS_HINT };
}

/** Rows a pay command should submit. Index is zero-based. */
export function rowsForCommand(rows, cmd) {
  const list = (rows || []).slice(0, 3);
  if (!cmd || cmd.kind !== 'pay') return [];
  if (cmd.index == null) return list;
  const row = list[cmd.index];
  return row ? [row] : [];
}

/**
 * EXACT_OUTPUT body. Amount is the USDC the merchant wants out (destination decimals).
 * recipient is the merchant account on the destination chain, never the deposit address.
 * dry stays true here. A deposit address is a separate checkout, and only at or under 0.20 USD.
 */
export function invoiceQuoteBody({ from, to, usd, recipient, refundTo, deadlineMs = Date.now() + 60 * 60 * 1000 } = {}) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'bad_usd', body: null };
  if (n > CHECKOUT_USD + 1e-8) return { ok: false, reason: 'over_checkout_cap', body: null, depositAddress: null };
  if (!from?.assetId || !to?.assetId) return { ok: false, reason: 'unknown_token', body: null };
  const decimals = Number(to.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return { ok: false, reason: 'bad_decimals', body: null };
  if (to.blockchain === 'near' && !nearAccountOk(recipient)) {
    return { ok: false, reason: 'near_recipient', body: null };
  }
  if (!recipient || !refundTo) return { ok: false, reason: 'bad_recipient', body: null };
  const [w, f = ''] = String(n).split('.');
  if (!/^\d+$/.test(w) || !/^\d*$/.test(f) || f.length > decimals) return { ok: false, reason: 'bad_usd', body: null };
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
  return 'No settled status yet. Not paid.';
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
  return `Not sent: ${why}.`;
}

/** Accountant CSV. A row without a tx stays "not sent". */
export function accountantCsv(receipts) {
  const lines = ['account,amount,asset,tx,status'];
  for (const r of receipts || []) {
    const tx = String(r.tx || '');
    const status = r.status || (tx ? 'sent' : 'not sent');
    const cells = [r.to || r.account || '', r.amount ?? r.amt ?? '', r.asset || 'NEAR', tx, status];
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
