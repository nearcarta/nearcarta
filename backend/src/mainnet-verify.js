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
  let j = null;
  // A public archival node answers a burst of 71 lookups with rate limits, and an
  // empty result then looks like a missing tx. Retry the transient answers only.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise(r => setTimeout(r, 250 * attempt));
    let res;
    try {
      res = await fetchImpl(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'EXPERIMENTAL_tx_status', params: { tx_hash: hash, sender_account_id: sender, wait_until: 'NONE' } }),
      });
    } catch (e) {
      if (attempt === 2) return { hash, found: false, error: e?.message || 'network', transient: true };
      continue;
    }
    if (res.ok === false) {
      if (attempt === 2) return { hash, found: false, error: `http ${res.status}`, transient: true };
      continue;
    }
    j = await res.json().catch(() => null);
    if (j?.result?.transaction) break;
    // NOT_FOUND is final; anything else (timeout, rate limit, unknown) is worth a retry.
    if (j?.error?.cause?.name === 'UNKNOWN_TRANSACTION' || j?.error?.cause?.name === 'NOT_FOUND') break;
  }
  const tx = j?.result?.transaction;
  if (!tx) {
    const name = j?.error?.cause?.name || j?.error?.name || '';
    // An absent tx is an answer; anything else failed to be read, and says so.
    const final = name === 'UNKNOWN_TRANSACTION' || name === 'NOT_FOUND';
    return { hash, found: false, error: name || 'not found', ...(final ? {} : { transient: true }) };
  }
  const status = j.result.status || {};
  const failure = Object.prototype.hasOwnProperty.call(status, 'Failure');
  return { hash, found: true, success: !failure && (Object.prototype.hasOwnProperty.call(status, 'SuccessValue') || Object.prototype.hasOwnProperty.call(status, 'SuccessReceiptId')), failure, signer: tx.signer_id || sender };
}

export async function checkAll(dep, { rpc, fetchImpl = fetch } = {}) {
  const rpcs = (Array.isArray(rpc) ? rpc : [rpc]).filter(Boolean);
  const rows = collectMainnetTxs(dep);
  // One hash can be recorded under several shops (a recovered house tx appears in
  // the retired record and the live one). Ask once, not four times, then reuse.
  const byHash = new Map();
  const lookup = async (row) => {
    if (byHash.has(row.hash)) return byHash.get(row.hash);
    let hit = { ...row, found: false, error: 'not found' };
    for (const sender of sendersFor(dep, row)) {
      for (const url of rpcs) {
        const one = await checkTx({ hash: row.hash, sender, rpc: url, fetchImpl });
        hit = { ...row, ...one, sender };
        if (one.found) break;
      }
      if (hit.found) break;
    }
    if (hit.found) byHash.set(row.hash, hit);
    return hit;
  };

  const out = await Promise.all(rows.map(lookup));
  // A public archival node can drop a lookup in a burst even when the tx is there:
  // the same hash came back found on one row and missing on the next in CI. Retry
  // the ones that did not resolve, with backoff, before calling them missing.
  const pending = () => out.map((r, i) => [r, i]).filter(([r]) => !r.found);
  for (let pass = 1; pass <= 3 && pending().length; pass += 1) {
    await new Promise(r => setTimeout(r, 400 * pass));
    for (const [, i] of pending()) {
      const again = await lookup({ ...rows[i] });
      if (again.found) out[i] = again;
      else out[i] = { ...out[i], error: again.error, ...(again.transient ? { transient: true } : {}) };
    }
  }
  return { ok: out.length > 0 && out.every(r => r.found), rows: out };
}
