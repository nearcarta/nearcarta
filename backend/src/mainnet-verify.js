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

export async function checkTx({ hash, sender, rpc, fetchImpl = fetch, tries = 3 }) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetchImpl(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'EXPERIMENTAL_tx_status', params: { tx_hash: hash, sender_account_id: sender, wait_until: 'NONE' } }),
    });
    // A rate limit says nothing about the tx. Retrying it must not be reported as "not found",
    // which is how one 429 turned a found tx into a CI failure.
    if (res.status === 429 || res.status >= 500) {
      last = { hash, found: false, retryable: true, error: `rpc ${res.status}` };
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
      continue;
    }
    const j = await res.json();
    const tx = j.result?.transaction;
    if (!tx) {
      const name = j.error?.cause?.name || j.error?.name || 'not found';
      last = { hash, found: false, retryable: /429|TIMEOUT|UNAVAILABLE/i.test(String(name)), error: name };
      if (last.retryable) { await new Promise(r => setTimeout(r, 250 * (attempt + 1))); continue; }
      return last;
    }
    const status = j.result.status || {};
    const failure = Object.prototype.hasOwnProperty.call(status, 'Failure');
    return { hash, found: true, success: !failure && (Object.prototype.hasOwnProperty.call(status, 'SuccessValue') || Object.prototype.hasOwnProperty.call(status, 'SuccessReceiptId')), failure, signer: tx.signer_id || sender };
  }
  return last;
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
  const missing = rows.filter(r => !r.found);
  return {
    ok: rows.length > 0 && missing.length === 0,
    rows,
    // A tx that could not be read because every endpoint rate-limited is not a missing tx.
    unread: missing.filter(r => r.retryable).map(r => ({ shop: r.shop, label: r.label, hash: r.hash, error: r.error })),
  };
}
