// Search, filter, page, export and a per-row hash check for the chronicle list.
// The hash check confirms the shape and the explorer link. It does not re-sign anything.

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

export const RECORDED = [
  { shop: 'board', decision: 'allowed', reason: '', h: '8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR' },
  { shop: 'board', decision: 'denied', reason: 'over_per_action_cap', h: 'CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF' },
  { shop: 'board', decision: 'denied', reason: 'receiver_not_allowlisted', h: 'E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ' },
  { shop: 'toll', decision: 'allowed', reason: '', h: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz' },
  { shop: 'toll', decision: 'denied', reason: 'receiver_not_allowlisted', h: 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR' },
  { shop: 'house', decision: 'allowed', reason: '', h: '83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26' },
];

export function queryFeed(rows, { q = '', decision = '', page = 1, pageSize = 4 } = {}) {
  const query = String(q || '').trim().toLowerCase();
  const all = (Array.isArray(rows) ? rows : []).filter(r => {
    if (decision && r.decision !== decision) return false;
    if (!query) return true;
    return [r.shop, r.decision, r.reason, r.h].join(' ').toLowerCase().includes(query);
  });
  const size = Math.max(1, Number(pageSize) || 4);
  const pages = Math.max(1, Math.ceil(all.length / size) || 1);
  const p = Math.min(pages, Math.max(1, Number(page) || 1));
  return { rows: all.slice((p - 1) * size, p * size), page: p, pages, total: all.length };
}

export function exportCsv(rows) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['shop,decision,reason,tx'];
  for (const r of rows || []) lines.push([r.shop, r.decision, r.reason || '', r.h || ''].map(cell).join(','));
  return lines.join('\n');
}

export function verifyEntry(row) {
  const h = String(row?.h || '');
  const ok = HASH.test(h);
  return {
    ok,
    url: ok ? `https://nearblocks.io/txns/${h}` : '',
    text: ok ? 'This hash has the shape of a NEAR transaction. Open it on the explorer to confirm the call.' : 'This row has no transaction hash to check.',
  };
}
