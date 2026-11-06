// Read-only check of the mainnet proof txs named in shared/deployments/mainnet.json.
// A refusal is still "found": the tx exists and its status is Failure. A missing tx is not.

export function collectMainnetTxs(dep) {
  const rows = [];
  const walk = (node, shop) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (node.txs && typeof node.txs === 'object' && !Array.isArray(node.txs)) {
      for (const [label, hash] of Object.entries(node.txs)) {
        if (typeof hash === 'string' && hash.length >= 32) rows.push({ shop, label, hash, contract: typeof node.contract === 'string' ? node.contract : null, ...(typeof node.signer === 'string' ? { signer: node.signer } : {}) });
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'txs' || !v || typeof v !== 'object') continue;
      walk(v, shop === 'mainnet' ? k : `${shop}.${k}`);
    }
  };
  walk(dep, 'mainnet');
  return rows;
}

export function sendersFor(dep, row) {
  // A visitor's implicit account (64 hex) signs its own txs, so it is a sender too.
  return [...new Set([row.signer, dep.root, row.contract, dep.charter?.contract, dep.factory?.contract].filter(s => typeof s === 'string' && (s.endsWith('.near') || /^[0-9a-f]{64}$/.test(s))))];
}

export async function checkTx({ hash, sender, rpc, fetchImpl = fetch }) {
  const res = await fetchImpl(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'EXPERIMENTAL_tx_status', params: { tx_hash: hash, sender_account_id: sender, wait_until: 'NONE' } }),
  });
  const j = await res.json();
  const tx = j.result?.transaction;
  if (!tx) {
    // Keep the code and the words: fastnear answers HTTP 200 with
    // {"error":{"code":-429,"message":"Rate limits exceeded..."}} and no name,
    // so a throttle must not read as "not found".
    const code = j.error?.code;
    const name = j.error?.cause?.name || j.error?.name;
    return { hash, found: false, error: name || (code != null ? String(code) : 'not found'), message: j.error?.message || '', code, status: res.status };
  }
  const status = j.result.status || {};
  const failure = Object.prototype.hasOwnProperty.call(status, 'Failure');
  return { hash, found: true, success: !failure && (Object.prototype.hasOwnProperty.call(status, 'SuccessValue') || Object.prototype.hasOwnProperty.call(status, 'SuccessReceiptId')), failure, signer: tx.signer_id || sender };
}

/** A throttled or failed call is not evidence the tx is missing. */
export const TRANSIENT = new Set(['-429', -429, '429', 'RATE_LIMITED', 'TIMEOUT_ERROR', 'REQUEST_VALIDATOR_ERROR']);
export const isThrottled = (one) => one.status === 429
  || TRANSIENT.has(one.error) || TRANSIENT.has(one.code)
  || /rate limit|-429|too many requests|timeout/i.test(String(one.message || ''));

export async function checkAll(dep, { rpc, fetchImpl = fetch, tries = 4, backoffMs = 500, paceMs = 120 } = {}) {
  const rpcs = (Array.isArray(rpc) ? rpc : [rpc]).filter(Boolean);
  const rows = [];
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (const row of collectMainnetTxs(dep)) {
    let hit = { ...row, found: false, error: 'not found' };
    for (const sender of sendersFor(dep, row)) {
      for (const url of rpcs) {
        // fastnear throttles a burst (HTTP 200 with code -429, and its archival host
        // now says it is deprecated). A throttle is "not answered", never "not on
        // chain", so pace the reads and retry with backoff. Without this, verify
        // flipped between 67/71 and 71/71 on an unchanged tree and took CI with it.
        for (let t = 0; t < tries; t++) {
          const one = await checkTx({ hash: row.hash, sender, rpc: url, fetchImpl });
          if (!isThrottled(one) || one.found) { hit = { ...row, ...one, sender }; break; }
          hit = { ...row, ...one, sender, throttled: true };
          if (t < tries - 1) await wait(backoffMs * 2 ** t);
        }
        if (hit.found) break;
      }
      if (hit.found) break;
    }
    rows.push(hit);
    if (paceMs) await wait(paceMs);
  }
  return { ok: rows.length > 0 && rows.every(r => r.found), rows };
}
