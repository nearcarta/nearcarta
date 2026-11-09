// Payroll review and durable invoice records for the Payouts shop. No wallet, no network.
// A NEAR row under the visitor's own cap is proposed on the board. A foreign row (USDC on Base, ...)
// is paid by the same session through the 1Click intents rail: the row is priced in NEAR by a dry quote,
// the quote must fit the visitor's per-payment cap, and the board's propose_call deposits wNEAR for the
// payee's address. No fixed business cap lives here; every limit comes from the visitor's row.
// Invoices are EXACT_OUTPUT. There is no product cap of 0.20 USD. A hosted abuse ceiling, when set, is config.
// ANY_INPUT is partner-only and is not used.
// https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types
// https://docs.near.org/protocol/transactions/meta-tx
// https://github.com/near/NEPs/blob/master/neps/nep-0141.md
import { foreignAddressOk, nearAccountOk } from '../../design/D8_shops/js/payouts.js';

export const MISS_HINT = 'Try: bill alice.near 0.3 USDC for the April article, Pay these rows, or Export CSV.';

// Native USDC on NEAR. The RPC accepts this 64-hex implicit account.
// The .factory.bridge.near alias is 84 characters, and every JSON-RPC rejects it as too long.
// storage_balance_bounds on this contract is 0.00125 NEAR. The receive account pays that, not this shop.
export const USDC_NEAR_CONTRACT = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const USDC_CONTRACT_FALLBACK = `${USDC_NEAR_CONTRACT}.factory.bridge.near`;
export const USDC_STORAGE_NEAR = '0.00125';

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
const EVM_CHAINS = new Set(['base', 'eth', 'ethereum', 'arb', 'arbitrum', 'op', 'optimism', 'pol', 'polygon', 'matic', 'bsc', 'bnb', 'avax', 'avalanche', 'gnosis', 'monad', 'xlayer', 'hypercore']);

export function addressOk(chain, value) {
  const c = String(chain || '').toLowerCase();
  const s = String(value || '').trim();
  if (!s || s.length > 128) return false;
  if (c === 'near') return nearAccountOk(s);
  if (EVM_CHAINS.has(c)) return /^0x[0-9a-fA-F]{40}$/.test(s);
  if (c === 'sol' || c === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  if (c === 'sui' || c === 'aptos') return /^0x[0-9a-fA-F]{64}$/.test(s);
  if (c === 'stellar') return /^G[A-Z2-7]{55}$/.test(s);
  return s.length >= 20 && !/\s/.test(s);
}

/**
 * Review a payroll. The visitor cap is the only limit. No 0.005 fallback.
 * A NEAR row's amount is NEAR. A foreign row's amount is the token on its own chain (for example USDC),
 * and its NEAR cost is the priced 1Click quote (`quotes[key].near`, the wNEAR the session deposits).
 * The cap is checked against that NEAR cost, so both kinds of row stay under the same visitor limit.
 * A row over the cap is refused before any deposit. A foreign row with no quote yet waits as 'quote'.
 */
export function classifyPayroll(rows, { capNear = null, max = null, quotes = null } = {}) {
  const src = max == null ? (rows || []) : (rows || []).slice(0, max);
  const cap = capNear == null || capNear === '' || !Number.isFinite(Number(capNear)) ? null : Number(capNear);
  const list = [];
  for (const r of src) {
    const asset = String(r?.asset || 'NEAR').toUpperCase();
    const chain = String(r?.chain || (asset === 'NEAR' ? 'near' : '')).toLowerCase();
    const to = String(r?.to || '').trim();
    const amt = Number(r?.amt);
    const foreign = asset !== 'NEAR' || chain !== 'near';
    if (!to) continue;
    const base = { to, amt, asset, chain: chain || 'unknown' };
    if (foreign && !foreignAddressOk(chain, to)) {
      list.push({ ...base, action: 'skip', send: false, reason: 'bad_account' });
      continue;
    }
    if (!foreign && !nearAccountOk(to)) {
      list.push({ ...base, action: 'skip', send: false, reason: 'bad_account' });
      continue;
    }
    if (!(amt > 0)) {
      list.push({ ...base, action: 'skip', send: false, reason: 'bad_amount' });
      continue;
    }
    if (cap == null) {
      list.push({ ...base, action: 'hold', send: false, reason: 'no_row' });
      continue;
    }
    if (!foreign) {
      if (amt > cap + 1e-12) {
        list.push({ ...base, action: 'refused', send: false, reason: 'over_per_action_cap' });
        continue;
      }
      list.push({ ...base, action: 'propose', send: true, reason: '' });
      continue;
    }
    const q = quotes && quotes[payrollKey({ to, amt, asset, chain })];
    if (!q) { list.push({ ...base, action: 'quote', send: false, reason: 'quote_needed' }); continue; }
    if (!q.ok) { list.push({ ...base, action: 'refused', send: false, reason: q.reason || 'quote_refused', quote: q }); continue; }
    const near = Number(q.near);
    if (!(near > 0)) { list.push({ ...base, action: 'refused', send: false, reason: 'quote_refused', quote: q }); continue; }
    if (near > cap + 1e-12) {
      list.push({ ...base, action: 'refused', send: false, reason: 'over_per_action_cap', quote: q, near });
      continue;
    }
    list.push({ ...base, action: 'send', send: true, reason: '', quote: q, near });
  }
  return {
    rows: list,
    propose: list.filter(r => r.action === 'propose'),
    send: list.filter(r => r.send),
    foreign: list.filter(r => r.action === 'send'),
    needsQuote: list.filter(r => r.action === 'quote'),
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

/**
 * A foreign payroll row's quote. The session deposits wNEAR into the 1Click rail and the rail pays
 * `to` exactly `amt` of the row's asset on that chain (EXACT_OUTPUT).
 * `near` is the wNEAR the session must deposit, read from the signed quote's amountInFormatted.
 */
export function payrollQuote(row, resp, { maxSlippage = 100 } = {}) {
  const q = resp?.quote || {};
  const near = Number(q.amountInFormatted);
  return {
    key: payrollKey(row),
    chain: String(row?.chain || '').toLowerCase(),
    asset: String(row?.asset || '').toUpperCase(),
    near: Number.isFinite(near) ? near : null,
    out: q.amountOutFormatted || null,
    outUsd: Number(q.amountOutUsd) || null,
    spreadUsd: resp?.spreadUsd ?? null,
    minutes: Number(q.timeEstimate) || null,
    depositAddress: q.depositAddress || null,
    depositMemo: q.depositMemo || null,
    deadline: q.deadline || null,
    correlationId: resp?.correlationId || null,
    ok: !!(Number.isFinite(near) && near > 0 && q.amountOutFormatted),
    reason: Number.isFinite(near) && near > 0 ? null : 'quote_refused',
    slippage: Number(maxSlippage) || 100,
  };
}

/** The fee the route charged, in USD, from signed fields only. */
export function payrollFeeUsd(q) {
  const inUsd = Number(q?.inUsd), outUsd = Number(q?.outUsd);
  if (!Number.isFinite(inUsd) || !Number.isFinite(outUsd)) return null;
  return Math.round((inUsd - outUsd) * 1e6) / 1e6;
}

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function pad2(n) { return String(n).padStart(2, '0'); }
function isoDay(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(now, n) {
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  return d;
}

/** Due and expiry from the day the visitor opens the form. Nothing here is a fixed calendar date. */
export function relativeInvoiceDates(now = new Date()) {
  const due = addDays(now, 7);
  const exp = addDays(now, 14);
  exp.setHours(18, 0, 0, 0);
  return { due: isoDay(due), expiry: `${isoDay(exp)}T18:00` };
}

/** Amounts the visitor actually wrote, in order. A model may not add one. */
export function amountsIn(text) {
  const out = [];
  const re = /\$\s*(\d+(?:\.\d+)?)|(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:usdc|usd)\b/gi;
  for (const m of String(text || '').matchAll(re)) {
    const n = Number(m[1] || m[2]);
    if (n > 0) out.push(n);
  }
  return out;
}

/** Named accounts and 64-hex accounts that appear in the words. */
export function accountsIn(text) {
  const found = [];
  const seen = new Set();
  const add = (id) => {
    const norm = String(id || '').trim().toLowerCase();
    if (!norm || seen.has(norm) || /^\d+(?:\.\d+)+$/.test(norm) || !nearAccountOk(norm)) return;
    seen.add(norm);
    found.push(norm);
  };
  for (const m of String(text || '').matchAll(/\b[0-9a-fA-F]{64}\b/g)) add(m[0]);
  for (const m of String(text || '').matchAll(/\b[a-z0-9][a-z0-9_-]{0,57}(?:\.[a-z0-9][a-z0-9_-]{0,57})+\b/gi)) add(m[0]);
  return found;
}

function escapeReg(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Drop the amount, the token and the receiver. What remains is the purpose. */
export function stripMemoFacts(chunk, source) {
  let s = String(chunk || '');
  s = s.replace(/\$\s*\d+(?:\.\d+)?/g, ' ');
  s = s.replace(/\b\d+(?:\.\d+)?\s*(?:usdc|usd)\b/gi, ' ');
  for (const id of accountsIn(source || chunk)) {
    s = s.replace(new RegExp(`\\b${escapeReg(id)}\\b`, 'ig'), ' ');
  }
  s = s.replace(/\b(?:usdc|usd)\b/gi, ' ');
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/^(?:to|for|an|a)\b\s*/i, '').trim();
  }
  if (!s || /^(?:to|for|usdc|usd|near|example)$/i.test(s)) return '';
  return s;
}

/**
 * The purpose in the visitor's words. "memo …" wins. Otherwise the last "for …"
 * that is still a purpose after the amount, token and receiver are removed.
 * No purpose word means an empty memo.
 */
export function memoFromWords(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  const explicit = text.match(/\bmemo\s+(.+?)(?:\s+\b(?:due|expir\w*)\b|$)/i);
  if (explicit) {
    const clean = stripMemoFacts(explicit[1], text);
    if (clean) return clean.slice(0, 140);
  }
  const stripped = stripMemoFacts(text, text);
  const parts = stripped.split(/\bfor\b/i).slice(1);
  for (let i = parts.length - 1; i >= 0; i--) {
    const cut = parts[i].replace(/\s+\b(?:due|expir\w*|memo)\b[\s\S]*$/i, '');
    const clean = stripMemoFacts(cut, text);
    if (clean) return clean.slice(0, 140);
  }
  return '';
}

function parseDue(raw, now) {
  const text = String(raw || '');
  const iso = text.match(/\bdue\s+(\d{4}-\d{2}-\d{2})\b/i);
  if (iso) return iso[1];
  if (/\bdue\s+tomorrow\b/i.test(text)) return isoDay(addDays(now, 1));
  const days = text.match(/\bdue\s+in\s+(\d+)\s+days?\b/i);
  if (days) return isoDay(addDays(now, Number(days[1])));
  if (/\bdue\s+next week\b/i.test(text)) return isoDay(addDays(now, 7));
  const mon = text.match(/\bdue\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (!mon) return '';
  const month = MONTHS[mon[1].toLowerCase()];
  const day = Number(mon[2]);
  let year = mon[3] ? Number(mon[3]) : now.getFullYear();
  if (!mon[3]) {
    const candidate = new Date(year, month, day);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (candidate < start) year += 1;
  }
  return isoDay(new Date(year, month, day));
}

function readInvoicePhrase(raw, now) {
  const amounts = amountsIn(raw);
  const accounts = accountsIn(raw);
  const named = /\b(invoice|bill|charge)\b/i.test(raw);
  if (!named && !(amounts.length && accounts.length)) return null;
  if (!amounts.length) return { ok: false, hint: 'Name the invoice amount, for example 0.15 USDC.' };
  return {
    ok: true,
    kind: 'invoice',
    usd: amounts[0],
    origin: /\bbase\b/i.test(raw) ? 'USDC@base' : 'USDC@near',
    destination: 'USDC@near',
    receive: accounts[0] || '',
    memo: memoFromWords(raw),
    due: parseDue(raw, now),
    hint: '',
  };
}

/**
 * Natural-language commands. A miss returns a hint and does not spend.
 * The amount and the account have to be in the words. Nothing here is raised.
 */
export function agentCommand(text, now = new Date()) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!t) return { ok: false, hint: MISS_HINT };
  if (/\bexport\b/.test(t) && /\bcsv\b/.test(t)) return { ok: true, kind: 'csv', hint: 'CSV ready. A row without a tx says not sent.' };
  if (/\b(status|overdue)\b/.test(t) && !amountsIn(raw).length) return { ok: true, kind: 'status', hint: '' };
  const one = t.match(/(?:send|pay)\s+payout\s+(\d+)/);
  if (one) {
    const n = Number(one[1]);
    if (!Number.isInteger(n) || n < 1) return { ok: false, hint: MISS_HINT };
    return { ok: true, kind: 'pay', index: n - 1, hint: '' };
  }
  if (/(pay these|pay reviewed|send payroll|send the payroll|pay the rows|pay payroll|send these|pay all)/.test(t)) {
    return { ok: true, kind: 'pay', index: null, hint: '' };
  }
  const invoice = readInvoicePhrase(raw, now);
  if (invoice) return invoice;
  return { ok: false, hint: MISS_HINT };
}

/**
 * A model parse is kept only when the account and the amount are in the visitor's words.
 * An invented payee is dropped. A raised amount is put back to the amount in the message.
 */
export function acceptModelIntent(text, model, fallback) {
  const local = fallback || agentCommand(text);
  if (!model || typeof model !== 'object') return { ...local, source: 'parser' };
  const kind = String(model.kind || '').toLowerCase();
  if (kind === 'pay' || kind === 'csv') {
    if (local.ok && local.kind === kind) return { ...local, source: 'model' };
    return { ...local, source: 'parser' };
  }
  if (kind !== 'invoice') return { ...local, source: 'parser' };
  const named = amountsIn(text);
  const accounts = accountsIn(text);
  if (!named.length) return { ...local, source: 'parser' };
  let receive = String(model.receive || '').trim().toLowerCase();
  const invented = !!receive && !accounts.some(a => a === receive);
  if (invented || !receive) receive = (local.kind === 'invoice' && local.receive) || accounts[0] || '';
  if (!nearAccountOk(receive)) return { ...local, source: 'parser' };
  const asked = local.kind === 'invoice' && local.usd ? local.usd : named[0];
  const modelUsd = Number(model.usd);
  const raised = !(modelUsd > 0) || modelUsd > Math.max(...named) + 1e-8;
  const usd = asked;
  let memo = memoFromWords(text);
  const modelMemo = stripMemoFacts(model.memo, text);
  if (!memo && modelMemo && String(text).toLowerCase().includes(modelMemo.toLowerCase())) memo = modelMemo.slice(0, 140);
  const due = local.due || (/^\d{4}-\d{2}-\d{2}$/.test(String(model.due || '')) ? model.due : '');
  return {
    ok: true,
    kind: 'invoice',
    usd,
    origin: local.origin || 'USDC@near',
    destination: 'USDC@near',
    receive,
    memo,
    due,
    hint: '',
    source: invented || raised ? 'parser' : 'model',
  };
}

/** What the agent says after it creates an invoice. The link is the full pay URL. */
export function agentInvoiceReply(inv, origin = '') {
  const link = (origin ? String(origin).replace(/\/$/, '') : '') + (inv?.href || '');
  const memo = inv?.memo ? ` for ${inv.memo}` : '';
  const due = inv?.due ? `, due ${prettyWhen(inv.due)}` : '';
  const href = link ? ` Here is the link. ${link}` : '';
  return `Made a ${inv?.usd} USDC invoice to ${inv?.receive}${memo}${due}.${href}`;
}

/** Stand-in used only on a dry indicative quote. Checkout still requires the payer's address.
 * 1Click refuses the burn address, so the EVM stand-in is the same sample the ferry dry quotes use. */
const EVM_SAMPLE = '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e';
export function indicativeRefund(chain) {
  const c = String(chain || '').toLowerCase();
  if (EVM_CHAINS.has(c)) return EVM_SAMPLE;
  if (c === 'sol' || c === 'solana') return '11111111111111111111111111111111';
  if (c === 'near') return 'nearcarta.near';
  if (c === 'sui' || c === 'aptos') return '0x' + '1'.repeat(64);
  if (c === 'stellar') return 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
  return '';
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

/** One invoice line: what it was for and what it cost. */
export function invoiceItem({ label = '', qty = 1, usd = '' } = {}) {
  const text = String(label || '').trim().slice(0, 80);
  const q = Number(qty);
  const price = Number(usd);
  if (!text) return null;
  if (!Number.isFinite(q) || q <= 0 || q > 100000) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  const each = Math.round(price * 1e6) / 1e6;
  return { label: text, qty: Math.round(q * 1000) / 1000, usd: Math.round(each * q * 1e6) / 1e6, each };
}

/**
 * Immutable invoice fields. The payer cannot replace these later.
 *
 * `items` is the line-item list a normal company expects. When items are given the total is
 * SUMMED FROM THEM and any `usd` passed alongside is ignored, so a bill can never show lines that
 * do not add up to the amount being charged. With no items this is the same single-amount invoice
 * it always was.
 */
export function canonicalInvoice({ usd, receive, memo = '', due = '', expiry = '', items } = {}) {
  const lines = Array.isArray(items) ? items.map(invoiceItem).filter(Boolean).slice(0, 20) : [];
  const lineTotal = lines.length ? Math.round(lines.reduce((a, l) => a + l.usd, 0) * 1e6) / 1e6 : null;
  const n = lineTotal != null ? lineTotal : Number(usd);
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
    value: { usd: rounded, receive: who, memo: memoS, due: dueS, expiry: expS, destination: 'USDC@near', asset: 'USDC', items: lines },
  };
}

/** Same invoice fields always produce the same id, so a second click does not open a second bill. */
export function invoiceRecordId(value) {
  // Items join the key: two bills for the same total but different work are different bills.
  const lines = Array.isArray(value.items) ? value.items.map(l => `${l.label}x${l.qty}@${l.each}`).join(',') : '';
  const key = [value.usd, String(value.receive).toLowerCase(), value.memo, value.due, value.expiry, lines].join('\n');
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
    // What the payer is buying. Empty for a plain one-amount invoice, so old invoices read the same.
    items: Array.isArray(record.items) ? record.items : [],
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

/** 1Click status words. Delivered is SUCCESS only. */export const INVOICE_STATUS = ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS', 'INCOMPLETE_DEPOSIT', 'REFUNDED', 'FAILED'];

export function invoiceDelivered(status) {
  return status === 'SUCCESS';
}

export function invoiceStatusLine(status) {
  const s = String(status || '');
  if (s === 'SUCCESS') return 'Delivered. The invoice was paid.';
  if (s === 'REFUNDED') return 'Refunded. Nothing else was sent.';
  if (s === 'FAILED') return 'The invoice swap failed. Nothing else was sent.';
  if (s === 'INCOMPLETE_DEPOSIT') return 'The deposit was short of the quote. Not paid.';
  if (s === 'PENDING_DEPOSIT') return 'Waiting for your deposit.';
  if (s === 'KNOWN_DEPOSIT_TX' || s === 'PROCESSING') return 'The deposit was seen. Not paid yet.';
  if (s === 'UNPAID') return 'Not paid.';
  return 'No settled status yet. Not paid.';
}

/**
 * NEP-141 storage. Meta-transactions pay gas, not storage_deposit.
 * https://docs.near.org/protocol/transactions/meta-tx
 * https://github.com/near/NEPs/blob/master/neps/nep-0141.md
 *
 * A zero-NEAR or unregistered issuer still has to be able to receive USDC. The contract will not
 * credit an unregistered account, so the money would sit in the swap. `sponsorshipPlan` is the
 * bounded fix: the visitor's own session row pays `storage_deposit` for the receive account, through
 * the same board `propose_call` that pays everything else, and only when all of these hold:
 *  - the plan is switched on for this deployment (config, not a price),
 *  - the receive account is a NEAR account the shop can register,
 *  - the row's per-payment cap can hold the deposit (so it is inside the visitor's own /setup limit),
 *  - the row's daily budget still has room after it,
 *  - the deposit is the contract's own `storage_balance_bounds.min`, never a number written by hand,
 *  - the account is not already registered (no repeat payment).
 * USDC on NEAR storage is 0.00125 NEAR at the time of writing; it is read, not assumed.
 */
export const USDC_STORAGE_SPONSOR_CALL = { receiver: USDC_NEAR_CONTRACT, method: 'storage_deposit' };

export function storageDepositArgs(account) {
  const who = String(account || '').trim();
  if (!nearAccountOk(who)) return null;
  return JSON.stringify({ account_id: who, registration_only: true });
}

export function sponsorshipPlan(input = {}) {
  const {
    enabled = false, account = '', minNear = USDC_STORAGE_NEAR, capNear = null, balanceNear = null,
    spentTodayNear = 0, dailyNear = null, registered = null,
  } = input;
  const who = String(account || '').trim();
  if (!enabled) return { ok: false, reason: 'sponsorship_off', call: null, depositNear: null };
  if (!nearAccountOk(who)) return { ok: false, reason: 'bad_receive', call: null, depositNear: null };
  if (registered === true) return { ok: false, reason: 'already_registered', call: null, depositNear: null };
  const need = Number(minNear);
  if (!Number.isFinite(need) || need <= 0) return { ok: false, reason: 'no_bounds', call: null, depositNear: null };
  const cap = Number(capNear);
  if (!Number.isFinite(cap) || cap <= 0) return { ok: false, reason: 'no_row', call: null, depositNear: null };
  if (need > cap + 1e-12) return { ok: false, reason: 'over_per_action_cap', call: null, depositNear: need };
  const daily = Number(dailyNear);
  if (Number.isFinite(daily) && daily > 0) {
    const spent = Number(spentTodayNear) || 0;
    if (spent + need > daily + 1e-12) return { ok: false, reason: 'over_daily_budget', call: null, depositNear: need };
  }
  const bal = Number(balanceNear);
  if (balanceNear != null && balanceNear !== '' && Number.isFinite(bal) && bal < need) {
    return { ok: false, reason: 'storage_reserve_low', call: null, depositNear: need };
  }
  return {
    ok: true,
    reason: null,
    call: { ...USDC_STORAGE_SPONSOR_CALL, args: storageDepositArgs(who), depositNear: need, gasTgas: 30 },
    depositNear: need,
    account: who,
    text: `This shop registers ${who} for USDC so the money can arrive. About ${need} NEAR of storage comes from your own session cap, not from the shop.`,
  };
}

export function registrationVerdict(viewResult, { error = null, minNear = USDC_STORAGE_NEAR, account = '' } = {}) {
  if (error) {
    return { ok: true, registered: null, claim: 'unknown', text: 'USDC registration is unknown. The invoice is still valid.' };
  }
  const total = viewResult && (viewResult.total ?? viewResult.total_balance);
  if (total != null && String(total) !== '0') {
    return { ok: true, registered: true, claim: 'registered', text: 'Registered for USDC. This account can hold USDC. No storage deposit is due.' };
  }
  const who = String(account || '').trim() || 'this account';
  return {
    ok: true,
    registered: false,
    claim: 'storage_required',
    text: `Needs USDC registration. This shop can register ${who} for you: the storage deposit (about ${minNear} NEAR) comes from your own session cap, not from the shop.`,
  };
}

/** What the payer sends, the fee and the time. A dry quote has no deposit address. */
export function quoteSummary(resp) {
  const q = resp?.quote || {};
  const sendUsd = Number(q.amountInUsd);
  const outUsd = Number(q.amountOutUsd);
  const fee = Number.isFinite(sendUsd) && Number.isFinite(outUsd) ? Math.round((sendUsd - outUsd) * 1e6) / 1e6 : null;
  return {
    send: q.amountInFormatted || null,
    sendUsd: Number.isFinite(sendUsd) ? sendUsd : null,
    receive: q.amountOutFormatted || null,
    feeUsd: fee,
    seconds: Number(q.timeEstimate) || null,
  };
}

export function quoteLine(summary) {
  if (!summary?.send) return '';
  const fee = summary.feeUsd == null ? '' : ` Fee about ${summary.feeUsd} USD.`;
  const time = summary.seconds ? ` About ${summary.seconds} seconds.` : '';
  const receive = summary.receive ? ` The invoice receives ${summary.receive} USDC on NEAR.` : '';
  return `You send ${summary.send} USDC.${fee}${time}${receive}`;
}

/** 1Click names the minimum in the destination token's smallest units. USDC on NEAR has 6 decimals. */
export function bridgeMinimumHint(message) {
  const raw = String(message || '').trim();
  const m = raw.match(/try at least (\d+)/i);
  if (!m) return raw || '1Click did not quote this amount.';
  const units = Number(m[1]);
  if (!(units >= 1000)) return raw;
  return `1Click needs at least ${(units / 1e6).toFixed(2)} USDC on this chain.`;
}

export function invoiceDoneLine(inv, origin = '') {
  const link = (origin ? String(origin).replace(/\/$/, '') : '') + (inv?.href || '');
  const when = prettyWhen(inv?.expiry);
  return [
    `Created an invoice for ${inv?.usd} USDC to ${inv?.receive}.`,
    inv?.memo ? `Memo: ${inv.memo}.` : '',
    when ? `Expires ${when}.` : '',
    link ? `Pay link: ${link}.` : '',
    'Creating an invoice signs nothing.',
  ].filter(Boolean).join(' ');
}

function prettyWhen(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  try {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(d) + ' UTC';
  } catch {
    return s;
  }
}

export const USDC_ORIGIN_CHAINS = [
  ['base', 'Base'], ['eth', 'Ethereum'], ['arb', 'Arbitrum'], ['op', 'Optimism'],
  ['pol', 'Polygon'], ['bsc', 'BNB Chain'], ['avax', 'Avalanche'], ['gnosis', 'Gnosis'],
  ['sol', 'Solana'], ['sui', 'Sui'], ['aptos', 'Aptos'], ['stellar', 'Stellar'],
  ['monad', 'Monad'], ['xlayer', 'X Layer'], ['hypercore', 'HyperCore'],
];
const CHAIN_LABEL = Object.fromEntries(USDC_ORIGIN_CHAINS);

export function chainLabel(id) {
  const key = String(id || '').toLowerCase();
  return CHAIN_LABEL[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : '');
}

/** USDC origins 1Click lists, excluding NEAR because the invoice already pays out there. */
export function usdcChoices(tokens) {
  const rows = (tokens || []).filter(t => String(t?.symbol || '').toUpperCase() === 'USDC' && String(t?.blockchain || t?.chain || '').toLowerCase() !== 'near');
  if (!rows.length) return USDC_ORIGIN_CHAINS.map(([id, label]) => ({ id, label: `USDC on ${label}`, assetId: '' }));
  const seen = new Set();
  const out = [];
  for (const t of rows) {
    const id = String(t.blockchain || t.chain).toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: `USDC on ${chainLabel(id)}`, assetId: t.assetId || '' });
  }
  return out;
}

const EXPLORER = {
  base: 'https://basescan.org/tx/',
  eth: 'https://etherscan.io/tx/',
  ethereum: 'https://etherscan.io/tx/',
  arb: 'https://arbiscan.io/tx/',
  op: 'https://optimistic.etherscan.io/tx/',
  pol: 'https://polygonscan.com/tx/',
  bsc: 'https://bscscan.com/tx/',
  avax: 'https://snowscan.xyz/tx/',
  gnosis: 'https://gnosisscan.io/tx/',
  sol: 'https://solscan.io/tx/',
};

export function paymentLinks({ destinationTx, nearTx, originTx, chain } = {}) {
  const links = [];
  const dest = destinationTx || nearTx || '';
  if (dest) links.push({ label: 'Delivered on NEAR', href: `https://nearblocks.io/txns/${dest}` });
  if (originTx) {
    const base = EXPLORER[String(chain || '').toLowerCase()];
    links.push({ label: 'Your deposit', href: base ? base + originTx : '', hash: originTx });
  }
  return links;
}

export function receiptLine(inv, status) {
  const paid = status === 'SUCCESS';
  return `Receipt ${inv?.id || ''}. ${inv?.usd ?? ''} USDC to ${inv?.receive || ''}. ${paid ? 'Delivered.' : invoiceStatusLine(status)}`;
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

/**
 * Accountant CSV. Paid requires a real SUCCESS or a delivered row. A row without either stays "not sent".
 * A foreign row shows the chain it paid to, the fee the route charged (USD), where a refund would go,
 * the NEAR the session deposited, and the deposit-address tx that is the row's receipt on NEAR.
 */
export function accountantCsv(receipts) {
  const lines = ['source,chain,destination,asset,amount,near,fee_usd,refund,status,tx'];
  for (const r of receipts || []) {
    const tx = String(r.tx || '');
    const raw = String(r.status || '');
    let status = r.status || (tx ? 'sent' : 'not sent');
    const success = r.delivered === true || String(r.oneClick || r.payoutStatus || '') === 'SUCCESS';
    if (/^paid$/i.test(status) && !success) status = 'not sent';
    if (success) status = 'paid';
    const foreign = String(r.chain || 'near').toLowerCase() !== 'near';
    const cells = [
      r.source || r.from || '',
      r.chain || (foreign ? '' : 'near'),
      r.to || r.destination || r.account || '',
      r.asset || '',
      r.amount ?? r.amt ?? '',
      r.near ?? (foreign ? '' : (r.amount ?? r.amt ?? '')),
      r.feeUsd ?? '',
      r.refund ?? '',
      status,
      tx,
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The reconcile block under the accountant CSV. It answers the questions a bookkeeper asks:
 * how many rows were sent, paid, refused or still waiting; the NEAR that left the session;
 * the USD the routes charged; and the refund address a unfinished swap returns to.
 * Nothing here is estimated: every number is summed from the receipts.
 */
export function csvReconcile(receipts, { refund = '' } = {}) {
  const rows = receipts || [];
  const count = pred => rows.filter(pred).length;
  const near = rows.reduce((t, r) => t + (Number(r.near) || 0), 0);
  const fee = rows.reduce((t, r) => t + (Number(r.feeUsd) || 0), 0);
  const paid = count(r => String(r.status) === 'paid' || r.payoutStatus === 'SUCCESS');
  const sent = count(r => String(r.status) === 'sent' || String(r.status) === 'paid' || r.payoutStatus === 'SUCCESS');
  const refused = count(r => r.status === 'refused');
  const waiting = count(r => r.payoutText && !/paid/i.test(String(r.status)) && String(r.status) !== 'refused');
  const notSent = count(r => r.status === 'not sent');
  return [
    `rows,${rows.length}`,
    `sent,${sent}`,
    `paid,${paid}`,
    `refused,${refused}`,
    `waiting,${waiting}`,
    `not_sent,${notSent}`,
    `near_deposited,${Math.round(near * 1e6) / 1e6}`,
    `fees_usd,${Math.round(fee * 1e6) / 1e6}`,
    `refund_to,${csvCell(refund || '')}`,
  ].join('\n');
}
