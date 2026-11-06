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

export async function checkTx({ hash, sender, rpc, fetchImpl = fetch, tries = 1, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  let last = { hash, found: false, error: 'not found' };
  for (let i = 0; i < tries; i += 1) {
    if (i > 0) await wait(Math.min(8000, 500 * 2 ** (i - 1)));
    let res;
    try {
      res = await fetchImpl(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'EXPERIMENTAL_tx_status', params: { tx_hash: hash, sender_account_id: sender, wait_until: 'NONE' } }),
      });
    } catch (e) {
      // A dropped connection says nothing about the transaction.
      last = { hash, found: false, error: e?.message || 'network', retry: true };
      continue;
    }
    const j = await res.json().catch(() => ({}));
    const tx = j.result?.transaction;
    if (!tx) {
      // A rate limit or a server error is not an answer about the transaction: retry.
      const msg = j.error?.message || '';
      const rate = j.error?.code === 429 || res.status === 429 || res.status >= 500 || /rate limit|too many request|timeout|try again/i.test(msg);
      last = { hash, found: false, error: j.error?.cause?.name || j.error?.name || msg || (res.status === 429 ? 'rate limited' : 'not found'), ...(rate ? { retry: true } : {}) };
      if (rate) continue;
      return last;
    }
    const status = j.result.status || {};
    const failure = Object.prototype.hasOwnProperty.call(status, 'Failure');
    return { hash, found: true, success: !failure && (Object.prototype.hasOwnProperty.call(status, 'SuccessValue') || Object.prototype.hasOwnProperty.call(status, 'SuccessReceiptId')), failure, signer: tx.signer_id || sender };
  }
  return last;
}

export async function checkAll(dep, { rpc, fetchImpl = fetch, tries = 4, wait, pauseMs = 120 } = {}) {
  const rpcs = (Array.isArray(rpc) ? rpc : [rpc]).filter(Boolean);
  const waitFn = wait || (ms => new Promise(r => setTimeout(r, ms)));
  const rows = [];
  let first = true;
  for (const row of collectMainnetTxs(dep)) {
    // Space the calls out so a free RPC does not answer the burst with 429s.
    if (!first && pauseMs > 0) await waitFn(pauseMs);
    first = false;
    let hit = { ...row, found: false, error: 'not found' };
    for (const sender of sendersFor(dep, row)) {
      for (const url of rpcs) {
        const one = await checkTx({ hash: row.hash, sender, rpc: url, fetchImpl, tries, wait: waitFn });
        hit = { ...row, ...one, sender };
        if (one.found) break;
      }
      if (hit.found) break;
    }
    rows.push(hit);
  }
  return { ok: rows.length > 0 && rows.every(r => r.found), rows };
}
