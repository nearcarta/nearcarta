// Search, filter, page, export and an on-chain status check for the chronicle list.
// A hash of the right shape is not a pass. The pass comes from a transaction status.

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

export function txVerdict(body) {
  if (!body || body.error) return { pass: false, why: body?.error || 'no status' };
  if (body.pass === true) return { pass: true, why: body.why || 'success' };
  if (body.pass === false) return { pass: false, why: body.why || 'failed' };
  const status = body.status && typeof body.status === 'object' ? body.status : null;
  if (status?.SuccessValue != null || status?.SuccessReceiptId != null) return { pass: true, why: 'success' };
  if (status?.Failure) return { pass: false, why: 'failure' };
  return { pass: false, why: 'unknown' };
}
const SIGNER = 'nearcarta.near';

export const RECORDED = [
  { shop: 'board', decision: 'allowed', reason: '', h: '8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR', signer: SIGNER },
  { shop: 'board', decision: 'denied', reason: 'over_per_action_cap', h: 'CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF', signer: SIGNER },
  { shop: 'board', decision: 'denied', reason: 'receiver_not_allowlisted', h: 'E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ', signer: SIGNER },
  { shop: 'toll', decision: 'allowed', reason: '', h: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz', signer: SIGNER },
  { shop: 'toll', decision: 'denied', reason: 'receiver_not_allowlisted', h: 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR', signer: SIGNER },
  { shop: 'house', decision: 'allowed', reason: '', h: '83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26', signer: SIGNER },
];

export function queryFeed(rows, { q = '', decision = '', page = 1, pageSize = 4, day = '' } = {}) {
  const query = String(q || '').trim().toLowerCase();
  const wantDay = String(day || '').slice(0, 10);
  const all = (Array.isArray(rows) ? rows : []).filter(r => {
    if (decision && r.decision !== decision) return false;
    if (wantDay && String(r.at || '').slice(0, 10) !== wantDay) return false;
    if (!query) return true;
    return [r.shop, r.decision, r.reason, r.label, r.what, r.h, r.amount, r.url].join(' ').toLowerCase().includes(query);
  });
  const size = Math.max(1, Number(pageSize) || 4);
  const pages = Math.max(1, Math.ceil(all.length / size) || 1);
  const p = Math.min(pages, Math.max(1, Number(page) || 1));
  return { rows: all.slice((p - 1) * size, p * size), page: p, pages, total: all.length };
}

const nearblocks = h => (h ? `https://nearblocks.io/txns/${h}` : '');

export function categoryOf(row) {
  const blob = `${row?.reason || ''} ${row?.label || ''} ${row?.note || ''}`.toLowerCase();
  if (blob.includes('refund')) return 'refunded';
  if (row?.decision === 'denied' || row?.decision === 'refused') return 'attempted';
  if (row?.decision === 'allowed') return 'delivered';
  return 'attempted';
}

export function csvTotals(rows) {
  const totals = { delivered: 0, refunded: 0, attempted: 0 };
  for (const row of rows || []) totals[categoryOf(row)] += 1;
  return totals;
}

export function exportCsv(rows) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['shop,decision,category,reason,amount,tx,url'];
  for (const r of rows || []) {
    const url = r.url || nearblocks(r.h);
    lines.push([r.shop, r.decision, categoryOf(r), r.reason || '', r.amount || '', r.h || '', url].map(cell).join(','));
  }
  const t = csvTotals(rows);
  lines.push(['totals', '', 'delivered', String(t.delivered), 'refunded', String(t.refunded), 'attempted', String(t.attempted)].map(cell).join(','));
  return lines.join('\n');
}

export function exportJson(rows) {
  return JSON.stringify((rows || []).map(r => ({
    shop: r.shop, decision: r.decision, reason: r.reason || '', amount: r.amount || '',
    tx: r.h || '', url: r.url || nearblocks(r.h),
  })), null, 2);
}

export function downloadCsv(csv, name = 'chronicle.csv', doc = globalThis.document) {
  if (!doc?.createElement) return { name, csv, downloaded: false };
  const a = doc.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.dataset.testid = 'chronicle-download';
  doc.body.append(a);
  a.click();
  a.remove();
  return { name, csv, downloaded: true };
}

export function verifyEntry(row, chain) {
  const h = String(row?.h || '');
  const shaped = HASH.test(h);
  const url = shaped ? `https://nearblocks.io/txns/${h}` : '';
  if (!chain) return { ok: false, pending: true, url, text: shaped ? 'Hash shape only. The chain has not been checked yet.' : 'This row has no transaction hash to check.' };
  const v = txVerdict(chain);
  return { ok: v.pass === true, pending: false, url, text: v.pass ? 'On chain: this transaction succeeded.' : `On chain: this transaction did not succeed (${v.why}).` };
}
