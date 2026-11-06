// Live timeline for any NEAR account. Public reads only. Nearblocks first, then FastNEAR,
// then NEAR RPC tx status. This module never holds a key and never signs.
import { DEP, cfg } from './config.js';
import { view } from './near.js';

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const TX_CAP = 6;
const FRESH_MS = 60_000;
const BUDGET_MS = 5200;
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function makeBudget(ms) {
  const t0 = Date.now();
  return { left: () => Math.max(0, ms - (Date.now() - t0)) };
}

function nbHeaders(key) {
  const headers = { accept: 'application/json' };
  const k = String(key || '').trim();
  if (k) headers.authorization = `Bearer ${k}`;
  return headers;
}

function rpcName(url) {
  const u = String(url || '');
  if (/archival/i.test(u)) return 'archival';
  if (/fastnear/i.test(u)) return 'fastnear';
  return 'rpc';
}

async function fetchJson(fetchFn, url, { method = 'GET', headers = {}, body = null, timeout = 1000, budget } = {}) {
  if (budget && budget.left() < 250) return { ok: false, status: 0, json: null };
  const ms = Math.max(200, Math.min(timeout, (budget?.left() ?? timeout) - 40));
  try {
    const r = await fetchFn(url, {
      method,
      headers,
      body: body == null ? undefined : body,
      signal: AbortSignal.timeout(ms),
    });
    const json = await r.json().catch(() => null);
    return { ok: !!r.ok && json != null, status: r.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

async function withRetry(budget, run) {
  let last = { ok: false, status: 0, json: null };
  for (let i = 0; i < 2; i++) {
    last = await run();
    if (last.ok) return last;
    const retry = last.status === 429 || last.status === 408 || last.status === 503 || last.status === 0 || last.status >= 500;
    if (!retry || i === 1 || (budget && budget.left() < 700)) return last;
    await sleep(Math.min(150, Math.max(40, Math.floor((budget?.left() || 150) / 4))));
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

async function rpcOnce(fetchFn, url, hash, sender, budget) {
  const hit = await fetchJson(fetchFn, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'chronicle', method: 'EXPERIMENTAL_tx_status',
      params: { tx_hash: hash, sender_account_id: sender, wait_until: 'NONE' },
    }),
    timeout: 900,
    budget,
  });
  if (!hit.ok || hit.json?.error || !hit.json?.result) {
    const unknown = hit.status === 0 || /UNKNOWN_TRANSACTION|unknown transaction/i.test(JSON.stringify(hit.json?.error || ''));
    return { hash, ok: false, success: false, unknown, via: rpcName(url) };
  }
  return { hash, ok: true, success: rpcOk(hit.json.result), unknown: false, via: rpcName(url) };
}

async function rpcStatus(fetchFn, urls, hash, sender, budget) {
  let last = { hash, ok: false, success: false, via: 'none' };
  for (const url of urls) {
    if (budget && budget.left() < 300) return last;
    last = await rpcOnce(fetchFn, url, hash, sender, budget);
    if (last.ok || !last.unknown) return last;
  }
  return { hash, ok: false, success: false, via: 'none' };
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

export function assembleLive({ account = '', boardContract = '', board = null, indexOk = false, ftOk = false, receipts = [], fts = [], confirmed = [], indexedCount = 0, txGap = '', ftGap = '' } = {}) {
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
    const gap = txGap || 'nearblocks.io did not answer.';
    sources.push({ source: 'transactions', ok: false, rows: 0, gap });
    gaps.push(gap);
  } else {
    for (const t of receipts) {
      if (!HASH.test(t.hash || '')) continue;
      const rpc = rpcBy.get(t.hash);
      const onBoard = boardId && (t.receiver === boardId || t.predecessor === boardId);
      const decision = rpc?.ok ? (rpc.success ? 'allowed' : 'failed') : (t.indexerOk === false ? 'failed' : 'allowed');
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
    const gap = ftGap || 'FT index did not answer.';
    sources.push({ source: 'ft', ok: false, rows: 0, gap });
    sources.push({ source: 'wrap.near', ok: false, rows: 0, gap: 'wrap.near was not read.' });
    sources.push({ source: '1click', ok: false, rows: 0, gap: 'No 1Click deposit matched.' });
    gaps.push(gap);
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
        decision: f.ok === false ? 'failed' : 'allowed',
        shop: click || wrap ? 'ferry' : 'ledger',
        note,
        amount: f.amount || '',
        at: f.at || '',
        url: link(f.hash),
        source,
        chain: click ? 'NEAR Intents' : 'NEAR',
      });
    }
    sources.push({ source: 'ft', ok: true, rows: seenFt.size, gap: seenFt.size ? '' : (ftGap || 'No fungible-token transfer on this page.') });
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

function detailOfFast(row) {
  const tx = row?.transaction || {};
  const actions = Array.isArray(tx.actions) ? tx.actions : [];
  const call = actions.find(a => a?.FunctionCall)?.FunctionCall;
  const transfer = actions.find(a => a?.Transfer)?.Transfer;
  const status = row?.execution_outcome?.outcome?.status;
  return {
    hash: tx.hash || '',
    signer: tx.signer_id || '',
    receiver: tx.receiver_id || '',
    method: call?.method_name || (transfer ? 'TRANSFER' : 'transaction'),
    amount: nearAmount(transfer?.deposit || call?.deposit),
    at: isoFromNs(row?.execution_outcome?.block_timestamp),
    success: !!(status && (Object.prototype.hasOwnProperty.call(status, 'SuccessValue') || Object.prototype.hasOwnProperty.call(status, 'SuccessReceiptId'))),
  };
}

function ftFromDetail(d, account) {
  if (!HASH.test(d?.hash || '')) return null;
  const click = d.receiver === INTENTS || d.signer === INTENTS;
  const wrap = d.receiver === WRAP || d.signer === WRAP;
  if (!click && !wrap && !/ft_transfer/i.test(d.method || '')) return null;
  return {
    hash: d.hash,
    symbol: '',
    contract: wrap ? WRAP : (click ? INTENTS : d.receiver),
    amount: d.amount || '',
    involved: click ? INTENTS : (d.signer || ''),
    affected: d.receiver || '',
    at: d.at || '',
    ok: d.success !== false,
    signer: d.signer || account,
  };
}

function cacheable(body) {
  const tx = (body?.sources || []).find(s => s.source === 'transactions');
  const ft = (body?.sources || []).find(s => s.source === 'ft');
  return !!(tx?.ok || ft?.ok);
}

async function load(account, deps) {
  const fetchFn = deps.fetch || fetch;
  const viewFn = deps.view || view;
  const boardContract = deps.board || DEP.board?.contract || '';
  const index = (deps.index || 'https://api.nearblocks.io').replace(/\/$/, '');
  const fastTx = (deps.fastnearTx || 'https://tx.main.fastnear.com').replace(/\/$/, '');
  const fastApi = (deps.fastnear || 'https://api.fastnear.com').replace(/\/$/, '');
  const rpcUrls = [deps.rpc || cfg.rpc, deps.archival || cfg.archivalRpc].filter(Boolean);
  const key = deps.nearblocksKey != null ? deps.nearblocksKey : (process.env.NEARBLOCKS_API_KEY || '');
  const headers = nbHeaders(key);
  const budget = deps.budget || makeBudget(BUDGET_MS);
  const id = encodeURIComponent(account);

  const boardPromise = (async () => {
    if (!boardContract) return { ok: false, row: null };
    try {
      const row = await withTimeout(viewFn(boardContract, 'get_charter', { owner: account }), 1200);
      return { ok: true, row: row || null };
    } catch {
      return { ok: false, row: null };
    }
  })();

  const [txNear, ftNear] = await Promise.all([
    withRetry(budget, () => fetchJson(fetchFn, `${index}/v1/account/${id}/txns?page=1&per_page=25`, { headers, timeout: 1100, budget })),
    withRetry(budget, () => fetchJson(fetchFn, `${index}/v1/account/${id}/ft-txns?page=1&per_page=10`, { headers, timeout: 1100, budget })),
  ]);

  let txSource = 'none';
  let ftSource = 'none';
  let receipts = [];
  let indexedCount = 0;
  let fts = [];
  let ftGap = '';
  let txGap = '';

  if (txNear.ok && Array.isArray(txNear.json?.txns)) {
    txSource = 'nearblocks';
    const grouped = groupReceipts(txNear.json.txns);
    indexedCount = grouped.length;
    const page = grouped.slice(0, TX_CAP);
    receipts = await mapLimit(page, 4, async (group) => {
      if (group.predecessor && budget.left() < 800) return describe(group, null);
      const detail = group.predecessor ? { ok: false } : await fetchJson(fetchFn, `${index}/v1/txns/${group.hash}`, { headers, timeout: 700, budget });
      return describe(group, detail.ok ? txnOf(detail.json) : null);
    });
  } else {
    const fx = await withRetry(budget, () => fetchJson(fetchFn, `${fastTx}/v0/account`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ account_id: account, limit: 25, desc: true }), timeout: 1100, budget,
    }));
    const list = Array.isArray(fx.json?.account_txs) ? fx.json.account_txs : null;
    if (fx.ok && list) {
      txSource = 'fastnear';
      indexedCount = list.length;
      const page = list.filter(t => HASH.test(t?.transaction_hash || '')).slice(0, TX_CAP);
      let details = [];
      if (page.length && budget.left() > 400) {
        const packed = await fetchJson(fetchFn, `${fastTx}/v0/transactions`, {
          method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ tx_hashes: page.map(t => t.transaction_hash) }), timeout: 1100, budget,
        });
        details = (packed.json?.transactions || []).map(detailOfFast);
      }
      const byHash = new Map(details.map(d => [d.hash, d]));
      receipts = page.map(t => {
        const d = byHash.get(t.transaction_hash) || {};
        return {
          hash: t.transaction_hash,
          signer: d.signer || (t.is_real_signer || t.is_signer ? account : ''),
          method: d.method || 'transaction',
          amount: d.amount || '',
          at: d.at || isoFromNs(t.tx_block_timestamp),
          receiver: d.receiver || '',
          predecessor: d.signer || '',
          indexerOk: t.is_success !== false,
        };
      });
    } else txGap = 'Transactions did not answer. nearblocks and FastNEAR were tried.';
  }

  if (ftNear.ok && Array.isArray(ftNear.json?.txns)) {
    ftSource = 'nearblocks';
    fts = ftNear.json.txns.map(t => mapFt(t, account));
  } else {
    const bal = await withRetry(budget, () => fetchJson(fetchFn, `${fastApi}/v1/account/${id}/ft`, { headers: { accept: 'application/json' }, timeout: 900, budget }));
    const fromTx = receipts.map(r => ftFromDetail({
      hash: r.hash, signer: r.signer, receiver: r.receiver, method: r.method, amount: r.amount, at: r.at, success: r.indexerOk !== false,
    }, account)).filter(Boolean);
    if (bal.ok && Array.isArray(bal.json?.tokens)) {
      ftSource = 'fastnear';
      fts = fromTx;
      if (!fromTx.length) ftGap = 'FastNEAR returned token balances, not a transfer list.';
    } else if (fromTx.length) {
      ftSource = 'fastnear';
      fts = fromTx;
    } else ftGap = 'FT index did not answer. nearblocks and FastNEAR were tried.';
  }

  const confirmed = await mapLimit(receipts.filter(t => t.signer).slice(0, TX_CAP), 4, (t) => rpcStatus(fetchFn, rpcUrls, t.hash, t.signer, budget));
  const rpcSource = confirmed.find(c => c.ok)?.via || (receipts.some(t => t.signer) ? 'none' : 'not asked');
  const body = assembleLive({
    account,
    boardContract,
    board: await boardPromise,
    indexOk: txSource !== 'none',
    ftOk: ftSource !== 'none',
    receipts,
    fts,
    confirmed,
    indexedCount,
    txGap,
    ftGap,
  });
  body.health = `Health: transactions ${txSource}. ft ${ftSource}. rpc ${rpcSource}.`;
  body.txSource = txSource;
  body.ftSource = ftSource;
  body.rpcSource = rpcSource;
  return body;
}

export async function readLive(account, deps = {}) {
  const id = String(account || '').trim();
  const clock = deps.now || Date.now;
  const hit = cache.get(id);
  if (hit && clock() - hit.at < FRESH_MS) return { ...hit.body, cached: true };
  if (hit) cache.delete(id);
  const body = await refresh(id, deps);
  return { ...body, cached: false };
}

function refresh(id, deps) {
  if (inflight.has(id)) return inflight.get(id);
  const clock = deps.now || Date.now;
  const p = load(id, deps).then(body => {
    if (cacheable(body)) cache.set(id, { at: clock(), body });
    return body;
  }).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}
