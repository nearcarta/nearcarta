// Live timeline for any NEAR account. Public reads only: a board view, the nearblocks
// index, and one NEAR RPC tx status per receipt. This module never holds a key and never signs.
import { DEP, cfg } from './config.js';
import { view } from './near.js';

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const TX_CAP = 6;
const FRESH_MS = 60_000;
const STALE_MS = 10 * 60_000;
const WRAP = 'wrap.near';
const INTENTS = 'intents.near';
const link = (h) => `https://nearblocks.io/txns/${h}`;

const cache = new Map();
const inflight = new Map();

export function _resetLiveCache() {
  cache.clear();
  inflight.clear();
}

function isoFromNs(ns) {
  try {
    const ms = Number(BigInt(String(ns || '0')) / 1000000n);
    if (!Number.isFinite(ms) || ms <= 0) return '';
    return new Date(ms).toISOString();
  } catch {
    return '';
  }
}

function nearAmount(deposit) {
  if (deposit == null || deposit === '' || deposit === 0 || deposit === '0') return '';
  const s = String(deposit);
  if (/^\d{18,}$/.test(s)) {
    const y = BigInt(s);
    const whole = y / 10n ** 24n;
    const frac = (y % 10n ** 24n).toString().padStart(24, '0').slice(0, 4).replace(/0+$/, '');
    const text = frac ? `${whole}.${frac}` : String(whole);
    return text === '0' ? '' : `${text} NEAR`;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return '';
  return `${n} NEAR`;
}

async function getJson(fetchFn, url) {
  let last = { ok: false, status: 0, json: null };
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetchFn(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
      const json = await r.json().catch(() => null);
      last = { ok: !!r.ok && json != null, status: r.status, json };
      if (last.ok) return last;
    } catch {
      last = { ok: false, status: 0, json: null };
    }
    if (i === 0) await new Promise(r => setTimeout(r, 300));
  }
  return last;
}

function groupReceipts(txns) {
  const map = new Map();
  for (const t of txns || []) {
    const hash = t?.transaction_hash;
    if (!HASH.test(hash || '')) continue;
    let g = map.get(hash);
    if (!g) {
      g = { hash, at: isoFromNs(t.block_timestamp), actions: [], predecessor: '', receiver: '', indexerOk: true };
      map.set(hash, g);
    }
    if (t.predecessor_account_id && t.predecessor_account_id !== 'system') g.predecessor = t.predecessor_account_id;
    if (t.receiver_account_id) g.receiver = t.receiver_account_id;
    if (t.receipt_outcome && t.receipt_outcome.status === false) g.indexerOk = false;
    for (const a of t.actions || []) g.actions.push(a);
  }
  return [...map.values()];
}

function txnOf(json) {
  if (!json || typeof json !== 'object') return null;
  if (Array.isArray(json.txns)) return json.txns[0] || null;
  if (json.signer_account_id) return json;
  return null;
}

function describe(group, detail) {
  const actions = detail?.actions?.length ? detail.actions : group.actions;
  const call = (actions || []).find(a => a?.action === 'FUNCTION_CALL' || a?.method);
  const transfer = (actions || []).find(a => a?.action === 'TRANSFER');
  return {
    hash: group.hash,
    signer: detail?.signer_account_id || (group.predecessor && group.predecessor !== 'system' ? group.predecessor : ''),
    method: call?.method || transfer?.action || call?.action || 'transaction',
    amount: nearAmount(transfer?.deposit ?? call?.deposit),
    at: group.at || isoFromNs(detail?.block_timestamp),
    receiver: detail?.receiver_account_id || group.receiver,
    predecessor: group.predecessor,
    indexerOk: group.indexerOk,
  };
}

function mapFt(t, account) {
  return {
    hash: t?.transaction_hash || '',
    symbol: t?.ft?.symbol || '',
    contract: t?.ft?.contract || '',
    amount: t?.delta_amount != null ? `${t.delta_amount} ${t?.ft?.symbol || ''}`.trim() : '',
    involved: t?.involved_account_id || '',
    affected: t?.affected_account_id || '',
    at: isoFromNs(t?.block_timestamp),
    ok: t?.outcomes?.status !== false,
    signer: account,
  };
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

function rpcOk(result) {
  const st = result?.status;
  if (!st || st.Failure || st.Unknown) return false;
  return Object.prototype.hasOwnProperty.call(st, 'SuccessValue') || Object.prototype.hasOwnProperty.call(st, 'SuccessReceiptId');
}

async function rpcOnce(fetchFn, url, hash, sender) {
  try {
    const r = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'chronicle', method: 'EXPERIMENTAL_tx_status',
        params: { tx_hash: hash, sender_account_id: sender, wait_until: 'NONE' },
      }),
      signal: AbortSignal.timeout(4000),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error || !j.result) {
      const unknown = /UNKNOWN_TRANSACTION|unknown transaction/i.test(JSON.stringify(j?.error || ''));
      return { hash, ok: false, success: false, unknown };
    }
    return { hash, ok: true, success: rpcOk(j.result), unknown: false };
  } catch {
    return { hash, ok: false, success: false, unknown: false };
  }
}

async function rpcStatus(fetchFn, urls, hash, sender) {
  let last = { hash, ok: false, success: false };
  for (const url of urls) {
    last = await rpcOnce(fetchFn, url, hash, sender);
    if (last.ok || !last.unknown) return last;
  }
  return { hash, ok: false, success: false };
}

function coverageLabel(rows, sources) {
  const bits = (sources || []).map(s => {
    if (!s.ok) return `${s.source} unanswered`;
    if (s.source === 'board') {
      if (s.gap && /found/.test(s.gap)) return 'board row, rules missing';
      if (s.gap && /No board/.test(s.gap)) return 'board none, rules missing';
      return 'board row';
    }
    if (s.source === '1click') return s.rows ? '1click matched, not a swap' : '1click none';
    if (s.source === 'rpc' && s.gap && /confirmed/.test(s.gap)) return `rpc ${s.gap.match(/\d+ of \d+/)?.[0] || 'partial'}`;
    if (s.source === 'transactions' && /Showing/.test(s.gap || '')) return `tx ${s.rows}+`;
    if (s.source === 'wrap.near') return s.rows ? `wrap ${s.rows}` : 'wrap none';
    if (s.rows) return `${s.source} ${s.rows}`;
    return `${s.source} none`;
  });
  const head = rows.length ? `Live timeline. ${rows.length} rows.` : 'No rows for this account.';
  return `${head} ${bits.join('. ')}.`;
}

export function assembleLive({ account = '', boardContract = '', board = null, indexOk = false, ftOk = false, receipts = [], fts = [], confirmed = [], indexedCount = 0 } = {}) {
  const gaps = [];
  const sources = [];
  const rows = [];
  const seen = new Set();
  const rpcBy = new Map((confirmed || []).map(c => [c.hash, c]));
  const boardId = boardContract || '';

  if (!board?.ok) {
    sources.push({ source: 'board', ok: false, rows: 0, gap: 'Board view did not answer.' });
    gaps.push('Board view did not answer.');
  } else if (board.row) {
    const version = board.row.rules?.version || board.row.version || '';
    const gap = version ? '' : 'Board row found. Historic rules version: missing.';
    sources.push({ source: 'board', ok: true, rows: 0, gap });
    if (gap) gaps.push(gap);
  } else {
    sources.push({ source: 'board', ok: true, rows: 0, gap: 'No board row for this account.' });
    gaps.push('No board row for this account.');
  }
  if (board?.ok && !gaps.some(g => /rules version/i.test(g))) gaps.push('Historic rules version: missing.');

  let txRows = 0;
  if (!indexOk) {
    sources.push({ source: 'transactions', ok: false, rows: 0, gap: 'nearblocks.io did not answer.' });
    gaps.push('nearblocks.io did not answer.');
  } else {
    for (const t of receipts) {
      if (!HASH.test(t.hash || '')) continue;
      const rpc = rpcBy.get(t.hash);
      const onBoard = boardId && (t.receiver === boardId || t.predecessor === boardId);
      const decision = rpc?.ok ? (rpc.success ? 'allowed' : 'denied') : (t.indexerOk === false ? 'denied' : 'allowed');
      rows.push({
        hash: t.hash,
        signer: t.signer || account,
        decision,
        shop: onBoard ? 'board' : 'ledger',
        note: t.method || 'transaction',
        amount: t.amount || '',
        at: t.at || '',
        url: link(t.hash),
        source: 'live',
        chain: 'NEAR',
      });
      seen.add(t.hash);
      txRows++;
    }
    const gap = indexedCount > receipts.length ? `Showing ${receipts.length} of ${indexedCount} indexed transactions.` : '';
    sources.push({ source: 'transactions', ok: true, rows: txRows, gap });
    if (!txRows) gaps.push('nearblocks.io returned no transactions for this account.');
    if (gap) gaps.push(gap);
  }

  let confirmedN = 0;
  const asked = (receipts || []).filter(t => HASH.test(t.hash || '') && t.signer).length;
  for (const t of receipts) {
    if (rpcBy.get(t.hash)?.ok) confirmedN++;
  }
  if (!indexOk) {
    sources.push({ source: 'rpc', ok: false, rows: 0, gap: 'RPC was not asked.' });
  } else if (!asked) {
    sources.push({ source: 'rpc', ok: true, rows: 0, gap: 'No receipt had a signer to confirm.' });
    gaps.push('No receipt had a signer to confirm.');
  } else {
    const gap = confirmedN === asked ? '' : `RPC confirmed ${confirmedN} of ${asked} receipts.`;
    sources.push({ source: 'rpc', ok: true, rows: confirmedN, gap });
    if (gap) gaps.push(gap);
  }

  let ftRows = 0;
  let wrapRows = 0;
  let clickRows = 0;
  const seenFt = new Set();
  if (!ftOk) {
    sources.push({ source: 'ft', ok: false, rows: 0, gap: 'FT index did not answer.' });
    sources.push({ source: 'wrap.near', ok: false, rows: 0, gap: 'wrap.near was not read.' });
    sources.push({ source: '1click', ok: false, rows: 0, gap: 'No 1Click deposit matched.' });
    gaps.push('FT index did not answer.');
    gaps.push('No 1Click deposit matched.');
  } else {
    for (const f of fts) {
      if (!HASH.test(f.hash || '')) continue;
      seenFt.add(f.hash);
      const wrap = f.contract === WRAP;
      const click = f.involved === INTENTS || f.affected === INTENTS || f.contract === INTENTS;
      const source = click ? '1click' : wrap ? 'wrap' : 'ft';
      if (wrap) wrapRows++;
      if (click) clickRows++;
      if (!wrap && !click) ftRows++;
      const note = click ? 'intents.near transfer' : wrap ? 'wrap.near transfer' : `${f.symbol || 'FT'} transfer`;
      if (seen.has(f.hash)) {
        const row = rows.find(r => r.hash === f.hash);
        if (row) {
          row.source = source;
          row.chain = click ? 'NEAR Intents' : row.chain;
          if (click || wrap) row.shop = 'ferry';
          row.note = `${row.note} · ${note}`.slice(0, 96);
          if (f.amount) row.amount = f.amount;
        }
        continue;
      }
      seen.add(f.hash);
      rows.push({
        hash: f.hash,
        signer: f.signer || account,
        decision: f.ok === false ? 'denied' : 'allowed',
        shop: click || wrap ? 'ferry' : 'ledger',
        note,
        amount: f.amount || '',
        at: f.at || '',
        url: link(f.hash),
        source,
        chain: click ? 'NEAR Intents' : 'NEAR',
      });
    }
    sources.push({ source: 'ft', ok: true, rows: seenFt.size, gap: seenFt.size ? '' : 'No fungible-token transfer on this page.' });
    sources.push({ source: 'wrap.near', ok: true, rows: wrapRows, gap: wrapRows ? '' : 'No wrap.near transfer on this page.' });
    const clickGap = clickRows
      ? '1Click matched an intents.near transfer. Not a completed swap.'
      : 'No 1Click deposit matched.';
    sources.push({ source: '1click', ok: true, rows: clickRows, gap: clickGap });
    if (!ftRows && !wrapRows && !clickRows) gaps.push('No fungible-token transfer on this page.');
    if (!wrapRows) gaps.push('No wrap.near transfer on this page.');
    gaps.push(clickGap);
  }

  return { account, live: true, rows, gaps, sources, label: coverageLabel(rows, sources) };
}

async function load(account, deps) {
  const fetchFn = deps.fetch || fetch;
  const viewFn = deps.view || view;
  const boardContract = deps.board || DEP.board?.contract || '';
  const index = (deps.index || 'https://api.nearblocks.io').replace(/\/$/, '');
  const rpcUrls = [deps.rpc || cfg.rpc, deps.archival || cfg.archivalRpc].filter(Boolean);
  const [boardRes, txRes, ftRes] = await Promise.all([
    (async () => {
      if (!boardContract) return { ok: false, row: null };
      try {
        const row = await viewFn(boardContract, 'get_charter', { owner: account });
        return { ok: true, row: row || null };
      } catch {
        return { ok: false, row: null };
      }
    })(),
    getJson(fetchFn, `${index}/v1/account/${encodeURIComponent(account)}/txns?page=1&per_page=25`),
    getJson(fetchFn, `${index}/v1/account/${encodeURIComponent(account)}/ft-txns?page=1&per_page=10`),
  ]);
  const indexOk = !!(txRes.ok && Array.isArray(txRes.json?.txns));
  const ftOk = !!(ftRes.ok && Array.isArray(ftRes.json?.txns));
  const grouped = indexOk ? groupReceipts(txRes.json.txns) : [];
  const page = grouped.slice(0, TX_CAP);
  const described = await mapLimit(page, 4, async (group) => {
    const detail = await getJson(fetchFn, `${index}/v1/txns/${group.hash}`);
    return describe(group, detail.ok ? txnOf(detail.json) : null);
  });
  const confirmed = await mapLimit(described.filter(t => t.signer), 4, (t) => rpcStatus(fetchFn, rpcUrls, t.hash, t.signer));
  return assembleLive({
    account,
    boardContract,
    board: boardRes,
    indexOk,
    ftOk,
    receipts: described,
    fts: ftOk ? (ftRes.json.txns || []).map(t => mapFt(t, account)) : [],
    confirmed,
    indexedCount: grouped.length,
  });
}

export async function readLive(account, deps = {}) {
  const id = String(account || '').trim();
  const clock = deps.now || Date.now;
  const hit = cache.get(id);
  if (hit && clock() - hit.at < STALE_MS) {
    if (clock() - hit.at >= FRESH_MS) refresh(id, deps).catch(() => {});
    return { ...hit.body, cached: true };
  }
  const body = await refresh(id, deps);
  return { ...body, cached: false };
}

function refresh(id, deps) {
  if (inflight.has(id)) return inflight.get(id);
  const clock = deps.now || Date.now;
  const p = load(id, deps).then(body => {
    cache.set(id, { at: clock(), body });
    return body;
  }).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}
