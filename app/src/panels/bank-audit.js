// Browser-side expense audit. Payee names stay out of the proof log.
// A tighter cap is monotonic. The live board session cannot write it yet.

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

function moneyOf(row) {
  const amount = Number(row?.amount ?? row?.near);
  const currency = String(row?.currency || (row?.near != null && row?.amount == null ? 'NEAR' : '')).toUpperCase();
  return { payee: String(row?.payee || '').trim(), amount, currency };
}

/** Counts and generic anomaly sentences. Payee names are not copied out. */
export function auditStatement(rows, { capNear, nearPerUnit, rateSource } = {}) {
  const list = (Array.isArray(rows) ? rows : []).map(moneyOf);
  const anomalies = [];
  const seen = new Map();
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
      if (row.payee) {
        const key = `${row.payee}|${row.amount}|${row.currency}`;
        seen.set(key, (seen.get(key) || 0) + 1);
      }
    }
  }
  if (blank) anomalies.push({ kind: 'blank-payee', text: blank === 1 ? 'One line has no payee.' : `${blank} lines have no payee.` });
  if (bad) anomalies.push({ kind: 'bad-amount', text: bad === 1 ? 'One line has no positive amount.' : `${bad} lines have no positive amount.` });
  if (over) anomalies.push({ kind: 'over-cap', text: over === 1 ? 'One line is above your current cap.' : `${over} lines are above your current cap.` });
  let dup = 0;
  for (const n of seen.values()) if (n > 1) dup += 1;
  if (dup) anomalies.push({ kind: 'duplicate', text: dup === 1 ? 'The same payee and amount appear more than once.' : `${dup} payee and amount pairs repeat.` });
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

/** Names the line the visitor asked about. This is not written to the proof log. */
export function biggestWaste(rows) {
  const list = (Array.isArray(rows) ? rows : []).map(moneyOf).filter(r => r.payee && Number.isFinite(r.amount) && r.amount > 0);
  if (!list.length) return null;
  const groups = new Map();
  for (const row of list) {
    const key = `${row.payee}|${row.amount}|${row.currency}`;
    const prev = groups.get(key) || { ...row, count: 0 };
    prev.count += 1;
    groups.set(key, prev);
  }
  const dups = [...groups.values()].filter(g => g.count > 1);
  const pool = dups.length ? dups : [...groups.values()];
  const pick = pool.sort((a, b) => b.amount - a.amount || b.count - a.count)[0];
  const largest = Math.max(...list.map(r => r.amount));
  const why = pick.count > 1
    ? `It appears ${pick.count} times${pick.amount === largest ? ' and it is the largest line' : ''}.`
    : 'It is the largest line.';
  return { payee: pick.payee, amount: round6(pick.amount), currency: pick.currency || 'as written', why, count: pick.count };
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
  // The live write waits for the board's tighten-only method. Nothing is signed here.
  return {
    ok: true,
    before,
    after,
    live: 'blocked',
    reason: 'Live tighten is blocked. Nothing was signed.',
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
  return [
    { id: 'model', label: 'Model', ok: !!(body?.model && model.ok), value: body?.model || '', why: body?.model ? (model.ok ? '' : (body?.failure || 'The model report did not pass')) : 'No model was checked' },
    { id: 'signer', label: 'Signing address', ok: signerOk, value: model.signing_address || '', why: signerOk ? '' : 'The signing address is not bound to the quote' },
    { id: 'tdx', label: 'TDX quote', ok: tdxOk, value: model.tcbStatus || gateway.tcbStatus || '', why: tdxOk ? '' : (gateway.error || model.error || body?.failure || 'The TDX quote did not pass') },
    { id: 'gpu', label: 'GPU quote', ok: gpuOk, value: gpuOk ? `${model.gpu.gpus || ''} GPU`.trim() : '', why: gpuOk ? '' : (model.gpu?.why || (model.gpu ? 'The GPU verdict did not pass' : 'No GPU evidence')) },
    { id: 'nonce', label: 'Nonce', ok: nonceOk, value: body?.nonce || '', why: nonceOk ? '' : 'The quote nonce does not match the one this page sent' },
    { id: 'signature', label: 'Response signature', ok: sigOk, value: sig.kind || '', why: sigOk ? '' : (sig.why || 'No completion was sent, so the response signature was not checked') },
  ];
}

/** Proof-log row. Counts and a nonce prefix only. */
export function proofLogEntry({ kind, lines, anomalyCount, nonce, eligible }) {
  return {
    at: new Date().toISOString(),
    kind: String(kind || 'audit'),
    lines: Number.isFinite(Number(lines)) ? Number(lines) : null,
    anomalyCount: Number.isFinite(Number(anomalyCount)) ? Number(anomalyCount) : null,
    nonce: nonce ? String(nonce).slice(0, 8) : '',
    eligible: !!eligible,
  };
}
