// Payouts (C3): a payout list the charter pays row by row, or as one all-or-nothing propose_batch (oath R16.1).
// Pure helpers, no wallet or DOM, so backend/test/unit/d8-payouts.test.js can test them in node.
// There is no business cap in this file. Every limit is passed in from the visitor's own row (/setup):
// the per-payment cap, the daily budget and the payments-per-day count. A missing limit is not a default.
export const MAX_BATCH = 5; // contracts/oath MAX_BATCH, a contract limit, not a price
const NAMED = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT = /^[0-9a-f]{64}$/;
export const nearAccountOk = id => { const s = String(id || '').trim(); return IMPLICIT.test(s) || NAMED.test(s); };

/** At or under the visitor's own per-payment cap. No cap read means no yes. */
export const nearAmountOk = (amt, cap) => {
  const n = Number(amt), c = Number(cap);
  if (cap == null || cap === '' || !Number.isFinite(c) || c <= 0) return false;
  return Number.isFinite(n) && n > 0 && n <= c + 1e-12;
};
export const formatNear = amt => {
  if (amt == null || String(amt).trim() === '') return '';
  const n = Number(amt);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 1e6) / 1e6);
};

/** Parse guard, not a business cap: one pasted statement is not a payroll. */
export const MAX_CSV_ROWS = 8;

/** A new row is blank. The row count comes from the visitor's own /setup count, never a constant. */
export function addPayoutRow(rows, max = null) {
  const list = (rows || []).map(r => ({ ...r, to: r?.to || '', amt: r?.amt ?? '' }));
  const limit = max == null || max === '' ? null : Number(max);
  if (limit != null && Number.isFinite(limit) && list.length >= limit) {
    return { rows: list, added: false, reason: `Your /setup allows ${limit} ${limit === 1 ? 'payment' : 'payments'} a day.` };
  }
  // A new row starts as a NEAR payment; the row's Chain and Asset fields can change it.
  list.push({ to: '', amt: '', asset: 'NEAR', chain: 'near' });
  return { rows: list, added: true, reason: '' };
}

/** One full sentence per issue. Blank rows are not errors yet. */
export function issueLine(x) {
  if (x.code === 'bad_account') return `${x.to} is not a NEAR account`;
  if (x.code === 'missing_account') return `${x.to} was not found on chain`;
  if (x.code === 'no_cap') return 'Your /setup cap is unread, so nothing is paid yet';
  return `${x.amt} NEAR is over your ${x.cap} NEAR per-payment cap`;
}

export function issueText(issues) {
  const seen = new Set();
  const lines = [];
  for (const x of issues || []) {
    const line = issueLine(x);
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.join('. ');
}

/**
 * NEAR rows must be real account ids at or under the visitor's cap.
 * A foreign row (USDC on Base, Arbitrum, ...) is checked against the payee address shape, not the NEAR cap:
 * its NEAR spend is the 1Click quote, checked when the row is priced.
 * A blank name is not an error, and an unread cap is an error only for a NEAR row.
 */
export function payoutIssues(rows, exists, cap = null) {
  const issues = [];
  const known = cap != null && cap !== '' && Number.isFinite(Number(cap));
  for (const r of rows || []) {
    const asset = String(r?.asset || 'NEAR').toUpperCase();
    const chain = String(r?.chain || (asset === 'NEAR' ? 'near' : '')).toLowerCase();
    const to = String(r?.to || '').trim();
    if (!to) continue;
    if (asset !== 'NEAR' || chain !== 'near') {
      if (!foreignAddressOk(chain, to)) issues.push({ code: 'bad_account', to });
      continue;
    }
    if (!nearAccountOk(to)) issues.push({ code: 'bad_account', to });
    else if (exists && exists[to] === false) issues.push({ code: 'missing_account', to });
    if (!known) { issues.push({ code: 'no_cap', to }); continue; }
    if (!nearAmountOk(r?.amt, cap)) issues.push({ code: 'over_cap', to, amt: r?.amt, cap });
  }
  return issues;
}

const EVM = /^0x[0-9a-fA-F]{40}$/;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Payee address shape per chain. Unsupported chains are refused, never guessed. */
export function foreignAddressOk(chain, value) {
  const c = String(chain || '').toLowerCase();
  const s = String(value || '').trim();
  if (!s || s.length > 128) return false;
  if (c === 'near') return nearAccountOk(s);
  if (['base', 'eth', 'ethereum', 'arb', 'arbitrum', 'op', 'optimism', 'pol', 'polygon', 'bsc', 'avax', 'gnosis'].includes(c)) return EVM.test(s);
  if (c === 'sol' || c === 'solana') return B58.test(s);
  if (c === 'btc' || c === 'bitcoin') return /^(bc1)[0-9a-z]{20,87}$/i.test(s) || /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s);
  return false;
}

/** Chains the 1Click rail pays a payroll row to. */
export const PAY_CHAINS = [
  ['near', 'NEAR'], ['base', 'Base'], ['arb', 'Arbitrum'], ['eth', 'Ethereum'], ['op', 'Optimism'], ['pol', 'Polygon'],
];
export const PAY_ASSETS = ['NEAR', 'USDC'];

const TG_PER = 30, TG_BASE = 30, TG_MAX = 300; // oath needs >= 25 Tgas per native item (MIN_GAS_NATIVE)
export const batchGasTgas = n => Math.min(TG_MAX, TG_BASE + TG_PER * n);
const Y18 = 10n ** 18n;
export const toYocto = n => (BigInt(Math.round(Number(n) * 1e6)) * Y18).toString();

/** Validate the list and build the proposals. Throws with a short reason; never signs anything. */
export function planBatch(rows, { payees, nonce, policy, nowMs, ttlMs = 10 * 60_000, clauseId = 'pay', shop = 'payouts' }) {
  const list = (rows || []).filter(r => r && r.to);
  if (list.length < 2) throw new Error('add at least 2 payouts');
  if (list.length > MAX_BATCH) throw new Error(`at most ${MAX_BATCH} payouts in one batch`);
  for (const r of list) {
    if (!(Number(r.amt) > 0)) throw new Error('every payout needs an amount above 0');
    if (!payees.includes(r.to)) throw new Error('pay only accounts your rules allow');
  }
  const expires = (BigInt(nowMs + ttlMs) * 1_000_000n).toString(), n = list.length;
  const ps = list.map((r, i) => ({ shop, clause_id: clauseId, receiver: r.to, amount: toYocto(r.amt), nonce: String(BigInt(nonce) + BigInt(i)),
    policy_version: policy, expires_at: expires, memo: `payouts:${i + 1}/${n}`, receipt: null }));
  const total = list.reduce((s, r) => s + Math.round(Number(r.amt) * 1e6), 0) / 1e6;
  return { ps, total, n, gasTgas: batchGasTgas(n) };
}

/** Read the charter's answer: every item allowed, or every item denied (the bad item's reason, the rest "batch_refused"). */
export function readBatch(value, n) {
  const v = Array.isArray(value) ? value : [];
  if (v.length !== n) return { decision: 'failed', reason: 'unexpected answer', paid: 0, bad: null, ids: [] };
  if (v.every(o => o.decision === 'allowed')) return { decision: 'allowed', reason: 'ok', paid: n, bad: null, ids: v.map(o => o.action_id) };
  const bad = v.findIndex(o => o.reason !== 'batch_refused');
  return { decision: 'denied', reason: bad >= 0 ? v[bad].reason : 'batch_refused', paid: 0, bad: bad >= 0 && v.some(o => o.reason === 'batch_refused') ? bad : null, ids: [] };
}

/** Drop rows with no payee. A list of only blank rows prepares nothing. */
export function prepareRows(rows) {
  const kept = [];
  let dropped = 0;
  for (const r of rows || []) {
    if (!String(r?.to || '').trim()) { dropped += 1; continue; }
    kept.push(r);
  }
  const note = !dropped
    ? ''
    : kept.length
      ? `Dropped ${dropped} ${dropped === 1 ? 'row' : 'rows'} with no payee.`
      : 'A row needs a payee. Nothing was prepared.';
  return { rows: kept, dropped, note, blocked: kept.length === 0 };
}

/**
 * One receipt per payout. A shared NEAR tx means one propose_batch. An empty tx means prepared, not sent.
 * feeUsd is what the route charged (1Click for a foreign row, the network for a NEAR row when known),
 * refund is where an unfinished swap returns to, chain is the destination chain.
 */
export function receiptsFor(rows, tx = '') {
  return (rows || []).map((r, i) => {
    const chain = String(r.chain || (String(r.asset || 'NEAR').toUpperCase() === 'USDC' ? 'base' : 'near')).toLowerCase();
    return {
      n: i + 1,
      to: r.to || r.receiver || '',
      amount: r.amt ?? r.amount ?? '',
      asset: String(r.asset || 'NEAR').toUpperCase() === 'USDC' ? 'USDC' : 'NEAR',
      chain,
      source: 'near',
      feeUsd: r.feeUsd ?? '',
      refund: r.refund ?? '',
      tx: tx || r.tx || '',
      destinationTx: r.destinationTx || '',
      url: (tx || r.tx) ? `https://nearblocks.io/txns/${tx || r.tx}` : '',
    };
  });
}

/** CSV lines: account,amount,asset,chain. Asset defaults to NEAR and chain defaults to the asset's home chain. */
export function parseCsv(text) {
  const rows = [];
  for (const line of String(text || '').split(/\n/)) {
    const t = line.trim();
    if (!t || /^account\b/i.test(t)) continue;
    const [to, amt, asset, chain] = t.split(',').map(s => s.trim());
    if (!to) continue;
    const a = (asset || 'NEAR').toUpperCase();
    rows.push({ to, amt: amt || '', asset: a, chain: (chain || (a === 'USDC' ? 'base' : 'near')).toLowerCase() });
  }
  return rows.slice(0, MAX_CSV_ROWS);
}

/** NEAR rows pay by propose. Every other row pays through the 1Click intents rail (a swap from the row). */
export function splitAssets(rows) {
  const list = rows || [];
  const isNear = r => String(r.asset || 'NEAR').toUpperCase() === 'NEAR' && String(r.chain || 'near').toLowerCase() === 'near';
  return {
    near: list.filter(isNear),
    usdc: list.filter(r => !isNear(r)),
  };
}

/** What is left of today's budget, in NEAR (usage from get_usage: spent + reserved). */
export function leftToday(clause, usage) {
  if (!clause) return 0;
  const used = BigInt(usage?.spent || 0) + BigInt(usage?.reserved || 0), left = BigInt(clause.daily_budget) - used;
  return left > 0n ? Number(left / 10n ** 18n) / 1e6 : 0;
}
