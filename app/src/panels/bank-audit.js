// Browser-side expense audit. The statement never leaves this module's return value
// as log text. A tighter cap is monotonic. The live board session cannot write it.

export const CSV_MAX_CHARS = 6000;
export const CSV_MAX_ROWS = 32;
export const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';

export const SAMPLES = [
  {
    id: 'cafe',
    name: 'Cafe week',
    rows: [
      { date: '2026-11-02', payee: 'cafe.near', near: 0.01 },
      { date: '2026-11-03', payee: 'cafe.near', near: 0.01 },
      { date: '2026-11-04', payee: 'books.near', near: 0.02 },
    ],
  },
  {
    id: 'travel',
    name: 'Travel week',
    rows: [
      { date: '2026-11-02', payee: 'ferry.near', near: 0.04 },
      { date: '2026-11-03', payee: '', near: 0.01 },
      { date: '2026-11-04', payee: 'inn.near', near: 0.2 },
    ],
  },
  {
    id: 'payroll',
    name: 'Payroll week',
    rows: [
      { date: '2026-11-01', payee: 'clerk.near', near: 0.03 },
      { date: '2026-11-01', payee: 'clerk.near', near: 0.03 },
      { date: '2026-11-02', payee: 'scribe.near', near: 0.02 },
    ],
  },
];

const round6 = n => Math.round(Number(n) * 1e6) / 1e6;

export function sampleById(id) {
  return SAMPLES.find(s => s.id === id) || SAMPLES[0];
}

export function parseStatementCsv(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return { ok: false, error: 'The file has no rows. Nothing was audited.' };
  if (raw.length > CSV_MAX_CHARS) return { ok: false, error: 'That file is over 6000 characters. Nothing was audited.' };
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { ok: false, error: 'The file needs a header and one row. Nothing was audited.' };
  const head = lines[0].toLowerCase().split(',').map(s => s.trim());
  const dateI = head.indexOf('date');
  const payeeI = head.indexOf('payee');
  const nearI = head.findIndex(h => h === 'near' || h === 'amount');
  if (payeeI < 0 || nearI < 0) return { ok: false, error: 'The header needs payee and near. Nothing was audited.' };
  const body = lines.slice(1);
  if (body.length > CSV_MAX_ROWS) return { ok: false, error: `That file has more than ${CSV_MAX_ROWS} rows. Nothing was audited.` };
  const rows = body.map(line => {
    const cells = line.split(',').map(s => s.trim());
    const near = Number(cells[nearI]);
    return {
      date: dateI >= 0 ? cells[dateI] || '' : '',
      payee: cells[payeeI] || '',
      near: Number.isFinite(near) ? near : NaN,
    };
  });
  return { ok: true, rows };
}

/** Counts and generic anomaly sentences. Payee names are not copied out. */
export function auditStatement(rows, { capNear } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const anomalies = [];
  const seen = new Map();
  let total = 0;
  let counted = 0;
  let max = 0;
  let blank = 0;
  let bad = 0;
  let over = 0;
  const cap = capNear != null && Number.isFinite(Number(capNear)) ? Number(capNear) : null;
  for (const row of list) {
    const payee = String(row?.payee || '').trim();
    const near = Number(row?.near);
    if (!payee) blank += 1;
    if (!Number.isFinite(near) || near <= 0) bad += 1;
    else {
      counted += 1;
      total += near;
      if (near > max) max = near;
      if (cap != null && near > cap) over += 1;
      if (payee) {
        const key = `${payee}|${near}`;
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
  const before = cap;
  let after = before;
  if (before != null && counted && max > 0 && max < before) after = round6(max);
  return {
    lines: list.length,
    counted,
    total: round6(total),
    largest: counted ? round6(max) : null,
    anomalies,
    before,
    after,
    tighten: before != null && after != null && after < before,
  };
}

export function tightenDecision({ beforeCap, afterCap, resetSpent, unfreeze, swapKey, widenReceivers, grantCalls, loosen } = {}) {
  if (resetSpent) return { ok: false, live: 'blocked', reason: 'Resetting spent is not a tighter limit. Nothing was signed.' };
  if (unfreeze) return { ok: false, live: 'blocked', reason: 'Unfreezing is not a tighter limit. Nothing was signed.' };
  if (swapKey) return { ok: false, live: 'blocked', reason: 'Swapping the key is not a tighter limit. Nothing was signed.' };
  if (widenReceivers) return { ok: false, live: 'blocked', reason: 'A wider payee list is not tighter. Nothing was signed.' };
  if (grantCalls) return { ok: false, live: 'blocked', reason: 'Granting calls is not tighter. Nothing was signed.' };
  if (loosen) return { ok: false, live: 'blocked', reason: 'A looser limit was refused. Nothing was signed.' };
  const before = Number(beforeCap);
  const after = Number(afterCap);
  if (!Number.isFinite(before) || before <= 0) return { ok: false, live: 'blocked', reason: 'No cap is on this row yet. Nothing was signed.' };
  if (!Number.isFinite(after) || after <= 0) return { ok: false, live: 'blocked', reason: 'The proposed cap is not a number. Nothing was signed.' };
  if (after > before) return { ok: false, live: 'blocked', reason: 'The proposed cap is higher than your current cap. Nothing was signed.' };
  if (after === before) return { ok: false, live: 'blocked', reason: 'The proposed cap matches the current cap. Nothing was signed.' };
  return {
    ok: true,
    before,
    after,
    live: 'blocked',
    reason: 'Live tighten is blocked. Nothing was signed.',
  };
}

export function freshNonce() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
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
