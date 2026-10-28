// Minimal NEAR JSON-RPC client: views, account/key reads, tx status, and NEP-297 event parsing.
import { cfg } from './config.js';

let rpcId = 0;
// Testnet RPCs rate-limit (HTTP 429) under load. Each call retries with backoff, falls through to fallback
// URLs, and read-only queries are cached briefly; if every endpoint fails, a recent cached answer is served
// (marked stale in /api/health) instead of a 500.
const RETRY_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRY_RPC = /TIMEOUT_ERROR|InternalError|Too Many Requests|SERVER_ERROR/i;
const CACHEABLE = new Set(['query', 'EXPERIMENTAL_protocol_config', 'block']);
const cache = new Map(); // key -> { at, value }
export const rpcStats = { calls: 0, retries: 0, fallbacks: 0, cacheHits: 0, staleServed: 0, lastError: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function _resetRpcCache() { cache.clear(); }

async function once(url, method, params) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(cfg.rpcTimeoutMs),
  });
  if (!r.ok) { const e = new Error(`rpc ${method} http ${r.status}`); e.retry = RETRY_HTTP.has(r.status); throw e; }
  const j = await r.json();
  if (j.error) {
    const e = new Error(`rpc ${method}: ${j.error.cause?.name || j.error.name || 'error'} ${JSON.stringify(j.error.data ?? j.error.cause?.info ?? '')}`);
    e.retry = RETRY_RPC.test(JSON.stringify(j.error)); throw e;
  }
  return j.result;
}

export async function rpc(method, params, url = cfg.rpc) {
  rpcStats.calls++;
  const finalityOk = !params || params.finality !== 'optimistic';
  const key = CACHEABLE.has(method) && finalityOk ? method + JSON.stringify(params) : null;
  const hit = key && cache.get(key);
  if (hit && Date.now() - hit.at < cfg.rpcCacheMs) { rpcStats.cacheHits++; return hit.value; }
  // A caller that passes its own URL (e.g. mainnet views) gets retries on that URL only.
  const urls = url === cfg.rpc ? [cfg.rpc, ...cfg.rpcFallbacks.filter((u) => u !== cfg.rpc)] : [url];
  let last;
  // Each round tries every URL once (primary first); rounds are separated by an exponential backoff.
  for (let round = 0; round < cfg.rpcRetries; round++) {
    for (let i = 0; i < urls.length; i++) {
      try {
        const value = await once(urls[i], method, params);
        if (key) { cache.set(key, { at: Date.now(), value }); if (cache.size > 2000) cache.delete(cache.keys().next().value); }
        return value;
      } catch (e) {
        last = e;
        const retry = e.retry || e.name === 'TimeoutError' || e.name === 'AbortError' || e.cause?.code || /fetch failed/.test(e.message);
        if (!retry) throw e; // a real answer (unknown account, contract panic): no point retrying
        if (i + 1 < urls.length) rpcStats.fallbacks++; else rpcStats.retries++;
      }
    }
    if (round + 1 < cfg.rpcRetries) await sleep(cfg.rpcBackoffMs * 2 ** round + Math.floor(Math.random() * 100));
  }
  rpcStats.lastError = { at: new Date().toISOString(), message: String(last?.message).slice(0, 200) };
  if (hit && Date.now() - hit.at < cfg.rpcStaleMs) { rpcStats.staleServed++; return hit.value; }
  throw last;
}

export async function view(accountId, method, args = {}, url = cfg.rpc) {
  const res = await rpc('query', {
    request_type: 'call_function', finality: 'final', account_id: accountId, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  }, url);
  if (res.error) throw new Error(`view ${accountId}.${method}: ${res.error}`);
  const txt = Buffer.from(res.result).toString('utf8');
  return txt ? JSON.parse(txt) : null;
}

export const viewAccount = (accountId, url = cfg.rpc) =>
  rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId }, url);

export const accessKeys = (accountId, url = cfg.rpc) =>
  rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: accountId }, url);

export const txStatus = (hash, sender) =>
  rpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: sender, wait_until: 'FINAL' });

// NEP-297: logs that start with EVENT_JSON:. A receipt that failed rolls back its state,
// but RPC still returns its logs. Those are phantom events: we drop them.
export function eventsFromOutcome(tx) {
  const all = [tx.transaction_outcome, ...(tx.receipts_outcome || [])];
  const out = [];
  for (const o of all) {
    const failed = !!o.outcome?.status?.Failure;
    for (const line of o.outcome?.logs || []) {
      if (!line.startsWith('EVENT_JSON:')) continue;
      let ev;
      try { ev = JSON.parse(line.slice(11)); } catch { continue; }
      if (typeof ev.standard !== 'string' || typeof ev.event !== 'string') continue;
      out.push({ ...ev, receipt_id: o.id, executor: o.outcome.executor_id, phantom: failed });
    }
  }
  return { events: out.filter(e => !e.phantom), dropped: out.filter(e => e.phantom).length };
}

// The first SuccessValue / Failure reason along the receipt chain, for a short human result.
export function txResult(tx) {
  const st = tx.status || {};
  if (st.Failure) return { ok: false, error: failureText(st.Failure) };
  for (const o of tx.receipts_outcome || []) {
    if (o.outcome.status?.Failure) return { ok: false, error: failureText(o.outcome.status.Failure) };
  }
  const v = st.SuccessValue;
  let value = null;
  if (v) { try { value = JSON.parse(Buffer.from(v, 'base64').toString('utf8')); } catch { value = v; } }
  return { ok: true, value };
}

function failureText(f) {
  const e = f.ActionError?.kind?.FunctionCallError?.ExecutionError;
  return e || JSON.stringify(f).slice(0, 300);
}

export const explorerTx = h => `https://testnet.nearblocks.io/txns/${h}`;
export const explorerAcct = a => `https://testnet.nearblocks.io/address/${a}`;
