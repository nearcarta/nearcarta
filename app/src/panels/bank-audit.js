// Browser-side expense audit. Payee names stay out of the proof log.
// A tighter cap is monotonic. The live board session cannot write it yet.

import { signatureLine, checkSplit, verifyResponseSignature, signerIdentity } from './signature-check.js';

export { verifyResponseSignature, signerIdentity, signatureLine, checkSplit };

export const CSV_MAX_CHARS = 6000;
export const CSV_MAX_ROWS = 32;
export const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
export const FORMAT_LINE = 'date, merchant or payee or description, amount or debit, and currency or category';
export const SAMPLE_CSV = `date,merchant,amount,currency,category
2026-11-01,Cafe,4.50,USD,food
2026-11-02,Cloud Host,29.00,USD,software
2026-11-03,Cloud Host,29.00,USD,software
2026-11-04,Books,12.00,USD,shopping
`;

export const SAMPLES = [
  {
    id: 'cafe',
    name: 'Cafe week',
    rows: [
      { date: '2026-11-02', payee: 'cafe.near', near: 0.01, currency: 'NEAR' },
      { date: '2026-11-03', payee: 'cafe.near', near: 0.01, currency: 'NEAR' },
      { date: '2026-11-04', payee: 'books.near', near: 0.02, currency: 'NEAR' },
    ],
  },
  {
    id: 'travel',
    name: 'Travel week',
    rows: [
      { date: '2026-11-02', payee: 'ferry.near', near: 0.04, currency: 'NEAR' },
      { date: '2026-11-03', payee: '', near: 0.01, currency: 'NEAR' },
      { date: '2026-11-04', payee: 'inn.near', near: 0.2, currency: 'NEAR' },
    ],
  },
  {
    id: 'payroll',
    name: 'Payroll week',
    rows: [
      { date: '2026-11-01', payee: 'clerk.near', near: 0.03, currency: 'NEAR' },
      { date: '2026-11-01', payee: 'clerk.near', near: 0.03, currency: 'NEAR' },
      { date: '2026-11-02', payee: 'scribe.near', near: 0.02, currency: 'NEAR' },
    ],
  },
];

const DATE_NAMES = ['date', 'posted', 'transaction date', 'trans date', 'txn date', 'posting date'];
const PAYEE_NAMES = ['merchant', 'payee', 'description', 'name', 'vendor', 'memo'];
const AMOUNT_NAMES = ['amount', 'debit', 'charge', 'near', 'value', 'sum'];
const CURRENCY_NAMES = ['currency', 'ccy', 'curr'];
const CATEGORY_NAMES = ['category', 'type'];

const round6 = n => Math.round(Number(n) * 1e6) / 1e6;
const amountText = n => {
  const v = round6(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

export function plural(n, one, many) {
  const k = Math.abs(Number(n) || 0);
  return `${Number(n) || 0} ${k === 1 ? one : many}`;
}

export function sampleById(id) {
  return SAMPLES.find(s => s.id === id) || SAMPLES[0];
}

export function freshNonce(bytes = 16) {
  const n = bytes === 32 ? 32 : 16;
  const buf = globalThis.crypto.getRandomValues(new Uint8Array(n));
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function pickColumn(head, names) {
  for (const name of names) {
    const i = head.indexOf(name);
    if (i >= 0) return { index: i, name };
  }
  return { index: -1, name: '' };
}

export function detectedLine(detected) {
  if (!detected) return '';
  const parts = [detected.date, detected.payee, detected.amount, detected.currency, detected.category].filter(Boolean);
  const money = detected.currency
    ? `Currency column ${detected.currency}.`
    : (detected.amount === 'near'
      ? 'The amount column is NEAR.'
      : 'No currency column. Amounts stay as written.');
  return `Detected ${parts.join(', ')}. ${money}`;
}

export function parseStatementCsv(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return { ok: false, error: 'The file has no rows. Nothing was audited.' };
  if (raw.length > CSV_MAX_CHARS) return { ok: false, error: 'That file is over 6000 characters. Nothing was audited.' };
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { ok: false, error: 'The file needs a header and one row. Nothing was audited.' };
  const head = splitCsvLine(lines[0]).map(s => s.toLowerCase());
  const date = pickColumn(head, DATE_NAMES);
  const payee = pickColumn(head, PAYEE_NAMES);
  const amount = pickColumn(head, AMOUNT_NAMES);
  const currency = pickColumn(head, CURRENCY_NAMES);
  const category = pickColumn(head, CATEGORY_NAMES);
  if (payee.index < 0 || amount.index < 0) {
    return { ok: false, error: 'The header needs a payee (merchant, payee, or description) and an amount (amount or debit). Nothing was audited.' };
  }
  const body = lines.slice(1);
  if (body.length > CSV_MAX_ROWS) return { ok: false, error: `That file has more than ${CSV_MAX_ROWS} rows. Nothing was audited.` };
  const rows = body.map(line => {
    const cells = splitCsvLine(line);
    const value = Number(String(cells[amount.index] || '').replace(/[$,]/g, ''));
    const code = currency.index >= 0 ? String(cells[currency.index] || '').trim().toUpperCase() : (amount.name === 'near' ? 'NEAR' : '');
    return {
      date: date.index >= 0 ? cells[date.index] || '' : '',
      payee: cells[payee.index] || '',
      amount: Number.isFinite(value) ? value : NaN,
      near: code === 'NEAR' && Number.isFinite(value) ? value : undefined,
      currency: code,
      category: category.index >= 0 ? cells[category.index] || '' : '',
    };
  });
  const detected = {
    date: date.name,
    payee: payee.name,
    amount: amount.name,
    currency: currency.name,
    category: category.name,
  };
  const codes = [...new Set(rows.map(r => r.currency).filter(Boolean))];
  return { ok: true, rows, detected, detectedText: detectedLine(detected), currency: codes.length === 1 ? codes[0] : '' };
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SUBSCRIPTIONS = ['netflix', 'spotify', 'hulu', 'disney+', 'disney plus', 'apple music', 'apple tv', 'icloud', 'youtube premium', 'youtube', 'adobe', 'dropbox', 'amazon prime', 'prime video', 'hbo', 'paramount', 'peacock', 'audible', 'github', 'notion'];

function moneyOf(row) {
  const amount = Number(row?.amount ?? row?.near);
  const currency = String(row?.currency || (row?.near != null && row?.amount == null ? 'NEAR' : '')).toUpperCase();
  return {
    payee: String(row?.payee || '').trim(),
    amount,
    currency,
    date: String(row?.date || '').trim(),
    category: String(row?.category || '').trim(),
  };
}

const MONTH_INDEX = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function parseDay(value) {
  const s = String(value || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return { y: +m[3], m: +m[1], d: +m[2] };
  m = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m) return { y: 0, m: +m[1], d: +m[2] };
  m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
  if (m) {
    const month = MONTH_INDEX[m[1].toLowerCase()];
    if (month) return { y: m[3] ? +m[3] : 0, m: month, d: +m[2] };
  }
  return null;
}

/** A spoken date becomes a day parseDay can group. Yearless dates stay month/day. */
export function spokenDate(text) {
  const s = String(text || '').trim().replace(/\.$/, '');
  if (!s) return '';
  const day = parseDay(s);
  if (!day) return '';
  const month = String(day.m).padStart(2, '0');
  const date = String(day.d).padStart(2, '0');
  return day.y ? `${day.y}-${month}-${date}` : `${day.m}/${day.d}`;
}

function dayLabel(d) {
  const month = MONTHS[d?.m] || 'that day';
  if (!d) return 'the same day';
  return d.y ? `${month} ${d.d}, ${d.y}` : `${month} ${d.d}`;
}

function timesWord(n) {
  return n === 2 ? 'twice' : `${n} times`;
}

function isSubscription(row) {
  const cat = String(row.category || '').toLowerCase();
  if (/subscription|streaming/.test(cat)) return true;
  const name = String(row.payee || '').toLowerCase();
  return SUBSCRIPTIONS.some(s => name === s || name.includes(s));
}

function genericRepeat(kind) {
  if (kind === 'same-day') return 'A payee and amount repeat on the same day.';
  if (kind === 'month') return 'A payee and amount repeat in the same month.';
  return 'A payee and amount repeat.';
}

/** Named lines for the tray and the agent. The proof log uses auditStatement, which omits payees. */
export function statementFindings(rows) {
  const list = (Array.isArray(rows) ? rows : []).map(moneyOf).filter(r => r.payee && Number.isFinite(r.amount) && r.amount > 0);
  const largest = list.reduce((m, r) => Math.max(m, r.amount), 0);
  const groups = new Map();
  for (const row of list) {
    const key = `${row.payee}|${row.amount}|${row.currency}`;
    const prev = groups.get(key) || { payee: row.payee, amount: row.amount, currency: row.currency, dates: [], category: row.category };
    prev.dates.push(row.date);
    if (row.category) prev.category = row.category;
    groups.set(key, prev);
  }
  const findings = [];
  for (const g of groups.values()) {
    if (g.dates.length < 2) continue;
    const days = g.dates.map(parseDay);
    const known = days.filter(Boolean);
    const dayKeys = new Set(known.map(d => `${d.y}-${d.m}-${d.d}`));
    const monthKeys = new Set(known.map(d => `${d.y}-${d.m}`));
    const unit = g.currency ? ` ${g.currency}` : ' as written';
    const shown = `${amountText(g.amount)}${unit}`;
    const times = timesWord(g.dates.length);
    const largestBit = round6(g.amount) === round6(largest) ? ' It is the largest line.' : '';
    let kind = 'repeat';
    let why = `It appears ${g.dates.length} times.${largestBit}`;
    if (known.length === g.dates.length && dayKeys.size === 1) {
      kind = 'same-day';
      why = `It appears ${times} on ${dayLabel(known[0])}. Likely a double charge.${largestBit}`;
    } else if (known.length === g.dates.length && monthKeys.size === 1) {
      kind = 'month';
      why = `It appears ${times} in ${MONTHS[known[0].m] || 'one month'}.${largestBit}`;
    }
    findings.push({
      kind,
      payee: g.payee,
      amount: round6(g.amount),
      currency: g.currency,
      count: g.dates.length,
      why,
      text: `${g.payee}, ${shown}. ${why}`,
    });
  }
  const order = { 'same-day': 0, month: 1, repeat: 2 };
  findings.sort((a, b) => (order[a.kind] - order[b.kind]) || b.amount - a.amount);
  const subs = [];
  const seen = new Set();
  for (const row of list) {
    if (!isSubscription(row)) continue;
    const key = row.payee.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    subs.push(row.payee);
  }
  if (subs.length === 1) findings.push({ kind: 'subscription', payee: subs[0], text: `${subs[0]} is a subscription.` });
  else if (subs.length > 1) {
    const text = `${subs.slice(0, -1).join(', ')} and ${subs[subs.length - 1]} are subscriptions.`;
    findings.push({ kind: 'subscription', payee: subs.join(', '), text });
  }
  return findings;
}

/** Counts and generic anomaly sentences. Payee names are not copied out. */
export function auditStatement(rows, { capNear, nearPerUnit, rateSource } = {}) {
  const list = (Array.isArray(rows) ? rows : []).map(moneyOf);
  const anomalies = [];
  let total = 0;
  let counted = 0;
  let max = 0;
  let blank = 0;
  let bad = 0;
  let over = 0;
  const currencies = new Set();
  const cap = capNear != null && Number.isFinite(Number(capNear)) ? Number(capNear) : null;
  for (const row of list) {
    if (!row.payee) blank += 1;
    if (!Number.isFinite(row.amount) || row.amount <= 0) bad += 1;
    else {
      counted += 1;
      total += row.amount;
      if (row.amount > max) max = row.amount;
      if (row.currency) currencies.add(row.currency);
      const inNear = row.currency === 'NEAR' ? row.amount : (Number.isFinite(Number(nearPerUnit)) ? row.amount * Number(nearPerUnit) : null);
      if (cap != null && inNear != null && inNear > cap) over += 1;
    }
  }
  if (blank) anomalies.push({ kind: 'blank-payee', text: blank === 1 ? 'One line has no payee.' : `${blank} lines have no payee.` });
  if (bad) anomalies.push({ kind: 'bad-amount', text: bad === 1 ? 'One line has no positive amount.' : `${bad} lines have no positive amount.` });
  if (over) anomalies.push({ kind: 'over-cap', text: over === 1 ? 'One line is above your current cap.' : `${over} lines are above your current cap.` });
  for (const finding of statementFindings(rows)) {
    if (finding.kind === 'subscription') continue;
    anomalies.push({ kind: finding.kind, text: genericRepeat(finding.kind) });
  }
  if (currencies.size > 1) anomalies.push({ kind: 'mixed', text: 'The statement uses more than one currency. Each amount stays in its own currency.' });
  const before = cap;
  const one = currencies.size === 1 ? [...currencies][0] : '';
  let after = before;
  let source = '';
  if (before != null && counted && max > 0 && currencies.size <= 1) {
    if (one === 'NEAR' || !one) {
      if (!one) source = 'No currency column was detected, so the cap was not converted.';
      else if (max < before) { after = round6(max); source = 'The statement is already in NEAR.'; }
      else source = 'The statement is already in NEAR. The largest line is not below the current cap.';
    } else if (Number.isFinite(Number(nearPerUnit)) && Number(nearPerUnit) > 0) {
      const asNear = max * Number(nearPerUnit);
      source = rateSource || 'A NEAR price was supplied for the cap only.';
      if (asNear < before) after = round6(asNear);
      else source = `${source} The converted line is not below the current cap.`;
    } else source = rateSource || `The cap was not converted. Amounts stay in ${one}.`;
  }
  return {
    lines: list.length,
    counted,
    total: round6(total),
    largest: counted ? round6(max) : null,
    currency: one,
    anomalies,
    before,
    after,
    tighten: before != null && after != null && after < before,
    rateSource: source,
  };
}

/** Names the largest repeated line. This is not written to the proof log. */
export function biggestWaste(rows) {
  const findings = statementFindings(rows).filter(f => f.kind !== 'subscription');
  if (findings.length) {
    const pick = [...findings].sort((a, b) => b.amount - a.amount || b.count - a.count)[0];
    return { payee: pick.payee, amount: pick.amount, currency: pick.currency || 'as written', why: pick.why, count: pick.count };
  }
  const list = (Array.isArray(rows) ? rows : []).map(moneyOf).filter(r => r.payee && Number.isFinite(r.amount) && r.amount > 0);
  if (!list.length) return null;
  const pick = [...list].sort((a, b) => b.amount - a.amount)[0];
  return { payee: pick.payee, amount: round6(pick.amount), currency: pick.currency || 'as written', why: 'It is the largest line.', count: 1 };
}

export const APPLY_NOTE = 'Apply tighter limits lowers the per-payment cap on your own board row. The session key in this browser signs it, so no wallet opens. The board refuses any looser rule.';

export function capFromSetup(liveCap, savedCap) {
  const live = Number(liveCap);
  if (Number.isFinite(live) && live > 0) return live;
  const saved = Number(savedCap);
  if (Number.isFinite(saved) && saved > 0) return saved;
  return null;
}

/** One sentence for the dock. Names the merchants in the loaded statement. */
export function agentReply(rows, question, { capNear, sampleName } = {}) {
  const findings = statementFindings(rows);
  const charges = findings.filter(f => f.kind !== 'subscription');
  const subs = findings.filter(f => f.kind === 'subscription');
  const head = sampleName ? `This is the ${sampleName} sample, not your statement. ` : '';
  if (question === 'subscription') {
    return subs.length ? `${head}${subs.map(s => s.text).join(' ')}` : `${head}No subscription is marked in this statement.`;
  }
  if (question === 'duplicate') {
    return charges.length ? `${head}${charges.map(f => f.text).join(' ')}` : `${head}No repeated payee and amount is in this statement.`;
  }
  if (question === 'limit') {
    if (capNear == null || !Number.isFinite(Number(capNear))) {
      return `${head}No per-payment cap is saved in /setup, so there is no limit to tighten. Nothing was signed.`;
    }
    return `${head}Your per-payment cap is ${capNear} NEAR. ${APPLY_NOTE}`;
  }
  const bits = [...charges, ...subs].map(f => f.text);
  if (!bits.length) return `${head}No repeated charge stands out in this statement.`;
  return `${head}${bits.join(' ')}`;
}

const ROW_STOP = new Set('check my spending spend spent audit the a an and or on for of in to please these this those rows row charges charge charged look looks like waste list statement any duplicates duplicate double subscription subscriptions with from is are was were twice times time paid pay i me tell about what which show also then plus at usd dollars dollar near cap limit limits nonce sample week your you'.split(' '));

function chargeCount(word) {
  const s = String(word || '').toLowerCase();
  if (!s) return 1;
  if (/twice|double|x2|two/.test(s)) return 2;
  const n = Number((s.match(/(\d+)/) || [])[1]);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, 12);
}

/**
 * Charges written in a chat line: merchant, amount, optional date, optional count.
 * "Spotify 9.99 twice on Oct 3 and Amazon 40" is three rows. A line with no amount is empty.
 */
export function rowsInMessage(text) {
  const src = String(text || '').replace(/[;|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!src) return [];
  const re = /(?<payee>[A-Za-z][A-Za-z0-9+'.&-]*)(?:\s+(?<extra>[A-Za-z][A-Za-z0-9+'.&-]*))?\s+(?:for\s+|of\s+|at\s+)?\$?(?<amount>\d+(?:\.\d{1,2})?)(?!\d)(?:\s+(?<count>twice|double|two\s+times|x2|\d+\s+times?))?(?:\s+on\s+(?<date>\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:,?\s*\d{4})?))?/gi;
  const rows = [];
  for (const m of src.matchAll(re)) {
    let payee = m.groups.payee;
    const extra = m.groups.extra || '';
    const extraStop = !extra || ROW_STOP.has(extra.toLowerCase()) || MONTH_INDEX[extra.toLowerCase()];
    if (ROW_STOP.has(payee.toLowerCase()) || MONTH_INDEX[payee.toLowerCase()]) {
      if (!extra || extraStop) continue;
      payee = extra;
    } else if (!extraStop) payee = `${payee} ${extra}`;
    const amount = Number(m.groups.amount);
    if (!payee || !Number.isFinite(amount) || amount <= 0) continue;
    const date = spokenDate(m.groups.date || '');
    const count = chargeCount(m.groups.count);
    for (let i = 0; i < count && rows.length < CSV_MAX_ROWS; i++) {
      rows.push({ date, payee, amount, currency: '', category: '' });
    }
  }
  return rows;
}

function singleChargeText(row) {
  const unit = row.currency ? ` ${row.currency}` : ' as written';
  return `${row.payee}, ${amountText(row.amount)}${unit}. It is a single charge.`;
}

/** Repeats, then single charges, then subscriptions. Used when the rows came from the message. */
export function messageAuditReply(rows) {
  const findings = statementFindings(rows);
  const repeats = findings.filter(f => f.kind !== 'subscription');
  const subs = findings.filter(f => f.kind === 'subscription');
  const repeated = new Set(repeats.map(f => f.payee.toLowerCase()));
  const seen = new Set();
  const singles = [];
  for (const row of (Array.isArray(rows) ? rows : []).map(moneyOf)) {
    if (!row.payee || !Number.isFinite(row.amount) || row.amount <= 0) continue;
    const key = row.payee.toLowerCase();
    if (repeated.has(key) || seen.has(key)) continue;
    seen.add(key);
    singles.push(singleChargeText(row));
  }
  const bits = [...repeats.map(f => f.text), ...singles, ...subs.map(f => f.text)];
  if (!bits.length) return 'No charge was named in that message.';
  return bits.join(' ');
}

/**
 * Keep a model sentence only when it names every merchant in the message.
 * A repeated charge also has to be described as a repeat. Otherwise the parser's sentence is the answer.
 */
export function preferModelSentence(answer, rows, fallback) {
  const text = String(answer || '').trim();
  const payees = [...new Set((Array.isArray(rows) ? rows : []).map(r => String(r.payee || '').trim()).filter(Boolean))];
  const local = String(fallback || '');
  if (!text || !payees.length) return { text: local, source: 'parser' };
  const low = text.toLowerCase();
  if (!payees.every(p => low.includes(p.toLowerCase()))) return { text: local, source: 'parser' };
  const repeats = statementFindings(rows).filter(f => f.kind !== 'subscription');
  if (repeats.length && !/twice|double|times|repeat|again/.test(low)) return { text: local, source: 'parser' };
  return { text: text.slice(0, 400), source: 'model' };
}

/** The verdict belongs to the nonce that was checked. Any other nonce has not been checked. */
export function attestForNonce({ nonce, checkedNonce, label, live, fields, pending } = {}) {
  if (pending && nonce && nonce !== checkedNonce) {
    return { label: '', live: 'Asking NEAR AI', fields: [], checked: false, pending: true };
  }
  if (!nonce || nonce !== checkedNonce) {
    return { label: '', live: 'Not checked yet.', fields: [], checked: false, pending: false };
  }
  return {
    label: label || '',
    live: live || 'Not checked yet.',
    fields: Array.isArray(fields) ? fields : [],
    checked: true,
    pending: false,
  };
}

export function browserSignatureLine(ok, algo, opts = {}) {
  const a = algo || opts.algo;
  if (a || opts.checked === false) return signatureLine({ ok, algo: a, checked: opts.checked !== false, why: opts.why });
  return ok
    ? 'signature checked in your browser: valid'
    : 'signature checked in your browser: not valid';
}

/** What ran where. Follows the algorithm the response named, so the claim cannot outrun the check. */
export function checkSplitFor(algo) {
  return checkSplit(algo);
}

export const CHECK_SPLIT = checkSplit('ecdsa');

/** Re-check the signature in the browser. The server flag is not enough. The algorithm comes from the response. */
export async function verifyBrowserSignature({ text, signature, signingAddress, algo } = {}) {
  const out = await verifyResponseSignature({ text, signature, signingAddress, algo });
  return out;
}

export function wasteSentence(waste, { sampleName } = {}) {
  if (!waste) return 'There is no line to call a waste. Paste a statement or choose a file.';
  const head = sampleName ? `This is the ${sampleName} sample, not your statement. ` : '';
  const unit = waste.currency && waste.currency !== 'as written' ? ` ${waste.currency}` : ' as written';
  return `${head}${waste.payee}, ${waste.amount}${unit}. ${waste.why}`;
}

export function tightenDecision({ beforeCap, afterCap, resetSpent, unfreeze, swapKey, widenReceivers, grantCalls, loosen } = {}) {
  if (resetSpent) return { ok: false, live: 'blocked', reason: 'Resetting spent is not a tighter limit. Nothing was signed.' };
  if (unfreeze) return { ok: false, live: 'blocked', reason: 'Unfreezing is not a tighter limit. Nothing was signed.' };
  if (swapKey) return { ok: false, live: 'blocked', reason: 'Swapping the key is not a tighter limit. Nothing was signed.' };
  if (widenReceivers) return { ok: false, live: 'blocked', reason: 'A wider payee list is not a tighter limit. Nothing was signed.' };
  if (grantCalls) return { ok: false, live: 'blocked', reason: 'Granting calls is not a tighter limit. Nothing was signed.' };
  if (loosen) return { ok: false, live: 'blocked', reason: 'A looser limit was refused. Nothing was signed.' };
  const before = Number(beforeCap);
  const after = Number(afterCap);
  if (!Number.isFinite(before) || before <= 0) return { ok: false, live: 'blocked', reason: 'No cap is on this row yet. Nothing was signed.' };
  if (!Number.isFinite(after) || after <= 0) return { ok: false, live: 'blocked', reason: 'The proposed cap is not a number. Nothing was signed.' };
  if (after > before) return { ok: false, live: 'blocked', reason: 'The proposed cap is higher than your current cap. Nothing was signed.' };
  if (after === before) return { ok: false, live: 'blocked', reason: 'The proposed cap matches the current cap. Nothing was signed.' };
  // The board's tighten_rules is shrink-only, so a lower cap is a real board write.
  // The send is in bank-tray.js: it reads the live row, then signs with the session key.
  return {
    ok: true,
    before,
    after,
    live: 'ready',
    reason: `Ready to tighten: cap ${before} NEAR → ${after} NEAR on your own board row.`,
  };
}

export function saltFor() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('');
}

/** Salted cap commitment. The statement is not an input. */
export function commitmentText({ nonce, afterNear, salt }) {
  return `bank-audit-v1|${nonce}|${afterNear}|${salt}`;
}

export async function hashText(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function modelEligibility({ model, teeOk, attested } = {}) {
  const name = String(model || '').trim();
  if (!name) return { eligible: false, proxied: false, label: 'No model is selected. Nothing was labelled TEE.' };
  const list = Array.isArray(attested) ? attested.filter(Boolean) : [];
  if (!teeOk) return { eligible: false, proxied: false, label: `${name} is not labelled TEE. The hardware check did not pass.` };
  if (!list.length || !list.includes(name)) {
    return { eligible: false, proxied: true, label: `${name} is proxied. It is not in the attested model list.` };
  }
  return { eligible: true, proxied: false, label: `${name} is on an attested report. That report is not this audit.` };
}

/** Quote fields for the attestation tab. A missing step is named, not skipped. */
export function attestFields(body, signature) {
  const models = Array.isArray(body?.models) ? body.models : [];
  const model = models[0] || {};
  const gateway = body?.gateway || {};
  const tdxOk = gateway.checks?.quote === true && model.checks?.quote === true && gateway.tcbStatus === 'UpToDate' && model.tcbStatus === 'UpToDate';
  const nonceOk = !!body?.nonce && gateway.checks?.nonceBound === true && model.checks?.nonceBound === true;
  const signerOk = model.checks?.signerBound === true && !!model.signing_address;
  const gpuOk = model.gpu?.ok === true;
  const sig = signature || {};
  const sigOk = sig.ok === true;
  const algo = String(body?.signingAlgo || model.signing_algo || gateway.signing_algo || sig.algo || '').toLowerCase();
  const who = signerIdentity({ signingAddress: model.signing_address, algo });
  return [
    { id: 'model', label: 'Model', where: 'server', ok: !!(body?.model && model.ok), value: body?.model || '', why: body?.model ? (model.ok ? '' : (body?.failure || 'The model report did not pass')) : 'No model was checked' },
    { id: 'signer', label: who.label, where: 'server', ok: signerOk && who.ok, value: model.signing_address || '', why: signerOk ? who.why : 'The signing address is not bound to the quote' },
    { id: 'tdx', label: 'TDX quote', where: 'server', ok: tdxOk, value: model.tcbStatus || gateway.tcbStatus || '', why: tdxOk ? '' : (gateway.error || model.error || body?.failure || 'The TDX quote did not pass') },
    { id: 'gpu', label: 'GPU quote', where: 'server', ok: gpuOk, value: gpuOk ? `${model.gpu.gpus || ''} GPU`.trim() : '', why: gpuOk ? '' : (model.gpu?.why || (model.gpu ? 'The GPU verdict did not pass' : 'No GPU evidence')) },
    { id: 'nonce', label: 'Nonce', where: 'server', ok: nonceOk, value: body?.nonce || '', why: nonceOk ? '' : 'The quote nonce does not match the one this page sent' },
    { id: 'signature', label: algo === 'ecdsa' ? 'ECDSA signature' : algo === 'ed25519' ? 'ed25519 signature' : 'Response signature', where: 'browser', ok: sigOk, algo, checked: sig.checked !== false, value: sigOk ? 'valid' : '', why: sigOk ? '' : (sig.why || 'No completion was sent, so the response signature was not checked') },
  ];
}

/** Proof-log row. Counts and a nonce prefix only. `evidence` names a real artifact, or nothing. */
export function proofLogEntry({ kind, lines, anomalyCount, nonce, eligible, evidence = null }) {
  const shown = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const url = String(item?.url || '');
    // An absolute link to a page that exists. A local preview is http; production is https.
    if (!/^https?:\/\/[^\s<>"']+$/i.test(url)) continue;
    shown.push({ label: String(item.label || 'artifact').slice(0, 40), url });
  }
  return {
    at: new Date().toISOString(),
    kind: String(kind || 'audit'),
    lines: Number.isFinite(Number(lines)) ? Number(lines) : null,
    anomalyCount: Number.isFinite(Number(anomalyCount)) ? Number(anomalyCount) : null,
    nonce: nonce ? String(nonce).slice(0, 8) : '',
    eligible: !!eligible,
    evidence: shown,
  };
}
