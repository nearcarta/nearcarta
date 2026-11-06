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
  const j = await res.json().catch(() => ({}));
  const tx = j.result?.transaction;
  // Only a JSON-RPC "unknown transaction" answer means the tx is absent. A throttled or failed
  // request says so, so a busy public RPC never reads as a missing proof.
  if (!tx) {
    const name = j.error?.cause?.name || j.error?.name || '';
    const transient = !name || /429|rate|busy|timeout|unavailable|internal|(-32|503|502)/i.test(String(name)) || (res.status && res.status >= 400);
    return { hash, found: false, transient: transient === true, error: name || (res.status ? `http ${res.status}` : 'not found') };
  }
  const status = j.result.status || {};
  const failure = Object.prototype.hasOwnProperty.call(status, 'Failure');
  return { hash, found: true, success: !failure && (Object.prototype.hasOwnProperty.call(status, 'SuccessValue') || Object.prototype.hasOwnProperty.call(status, 'SuccessReceiptId')), failure, signer: tx.signer_id || sender };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

export async function checkAll(dep, { rpc, fetchImpl = fetch, retryMs = 1200, paceMs = 80, passes = 4 } = {}) {
  const rpcs = (Array.isArray(rpc) ? rpc : [rpc]).filter(Boolean);
  const rows = [];
  // The same tx can be cited by more than one record (a retired house v2 and its v3 successor).
  // Read each hash once, so a busy public RPC sees the fewest requests it can.
  const seen = new Map();
  for (const row of collectMainnetTxs(dep)) {
    if (seen.has(row.hash)) { rows.push({ ...row, ...seen.get(row.hash) }); continue; }
    let hit = { ...row, found: false, error: 'not found' };
    // A real answer ends the search. A throttled one does not: ask again after a short wait.
    for (let pass = 0; pass < passes && !hit.found; pass++) {
      let throttled = false;
      for (const sender of sendersFor(dep, row)) {
        for (const url of rpcs) {
          const one = await checkTx({ hash: row.hash, sender, rpc: url, fetchImpl });
          if (one.found) { hit = { ...row, ...one, sender }; break; }
          throttled = throttled || one.transient === true;
          hit = { ...row, ...one, sender };
        }
        if (hit.found) break;
      }
      if (hit.found || !throttled) break;
      await wait(retryMs * (pass + 1));
    }
    seen.set(row.hash, { found: hit.found, ...(hit.found ? { success: hit.success, failure: hit.failure, signer: hit.signer } : { error: hit.error }), ...(hit.transient ? { transient: true } : {}) });
    rows.push(hit);
    if (paceMs) await wait(paceMs);
  }
  return { ok: rows.length > 0 && rows.every(r => r.found), rows };
}
