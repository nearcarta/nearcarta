// Read-only check of the mainnet proof txs named in shared/deployments/mainnet.json.
// A refusal is still "found": the tx exists and its status is Failure. A missing tx is not.

export function collectMainnetTxs(dep) {
  const rows = [];
  const walk = (node, shop) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (node.txs && typeof node.txs === 'object' && !Array.isArray(node.txs)) {
      for (const [label, hash] of Object.entries(node.txs)) {
        if (typeof hash === 'string' && hash.length >= 32) rows.push({ shop, label, hash, contract: typeof node.contract === 'string' ? node.contract : null });
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
  return [...new Set([dep.root, row.contract, dep.charter?.contract, dep.factory?.contract].filter(s => typeof s === 'string' && s.endsWith('.near')))];
}

export async function checkTx({ hash, sender, rpc, fetchImpl = fetch }) {
  const res = await fetchImpl(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'EXPERIMENTAL_tx_status', params: { tx_hash: hash, sender_account_id: sender, wait_until: 'NONE' } }),
  });
  const j = await res.json();
  const tx = j.result?.transaction;
  if (!tx) return { hash, found: false, error: j.error?.cause?.name || j.error?.name || 'not found' };
  const status = j.result.status || {};
  const failure = Object.prototype.hasOwnProperty.call(status, 'Failure');
  return { hash, found: true, success: !failure && (Object.prototype.hasOwnProperty.call(status, 'SuccessValue') || Object.prototype.hasOwnProperty.call(status, 'SuccessReceiptId')), failure, signer: tx.signer_id || sender };
}

export async function checkAll(dep, { rpc, fetchImpl = fetch } = {}) {
  const rpcs = (Array.isArray(rpc) ? rpc : [rpc]).filter(Boolean);
  const rows = [];
  for (const row of collectMainnetTxs(dep)) {
    let hit = { ...row, found: false, error: 'not found' };
    for (const sender of sendersFor(dep, row)) {
      for (const url of rpcs) {
        const one = await checkTx({ hash: row.hash, sender, rpc: url, fetchImpl });
        hit = { ...row, ...one, sender };
        if (one.found) break;
      }
      if (hit.found) break;
    }
    rows.push(hit);
  }
  return { ok: rows.length > 0 && rows.every(r => r.found), rows };
}
