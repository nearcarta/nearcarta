// Minimal NEAR JSON-RPC client: views, account/key reads, tx status, and NEP-297 event parsing.
import { cfg } from './config.js';

let rpcId = 0;
export async function rpc(method, params, url = cfg.rpc) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  if (!r.ok) throw new Error(`rpc ${method} http ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`rpc ${method}: ${j.error.cause?.name || j.error.name || 'error'} ${JSON.stringify(j.error.data ?? j.error.cause?.info ?? '')}`);
  return j.result;
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
