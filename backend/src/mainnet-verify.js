// Read-only check of the mainnet proof txs named in shared/deployments/mainnet.json.
// A refusal is still "found": the tx exists and its status is Failure. A missing tx is not.
//
// A public archival node answers a burst of lookups with rate limits, and a rate
// limit then looks like a missing tx. Lookups are spaced out, a transient answer
// is retried on the next endpoint, and only a real NOT_FOUND is final.

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** One lookup. `tries` attempts with backoff; a 429, a 5xx, a timeout, or an
 *  unreadable body is retried, while a real NOT_FOUND is answered at once. */
export async function checkTx({ hash, sender, rpc, fetchImpl = fetch, tries = 3, wait = sleep }) {
  let last = { hash, found: false, error: 'not found' };
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (attempt) await wait(Math.min(8000, 500 * 2 ** (attempt - 1)));
    let res;
    try {
      res = await fetchImpl(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'EXPERIMENTAL_tx_status', params: { tx_hash: hash, sender_account_id: sender, wait_until: 'NONE' } }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      // A dropped connection or a timeout says nothing about the transaction.
      last = { hash, found: false, error: e?.message || 'network', retry: true };
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      // A gateway page or an empty body is not an answer about the transaction.
      last = { hash, found: false, error: `unreadable response ${res.status}`, retry: true };
      continue;
    }
    const tx = body.result?.transaction;
    if (!tx) {
      const msg = body.error?.message || '';
      const name = body.error?.cause?.name || body.error?.name || '';
      // NOT_FOUND is final; anything else (rate limit, timeout, server error) is worth a retry.
      const final = name === 'UNKNOWN_TRANSACTION' || name === 'NOT_FOUND';
      const transient = !final && (body.error?.code === 429 || res.status === 429 || res.status >= 500 || /rate limit|too many request|timeout|try again/i.test(msg));
      last = { hash, found: false, error: name || msg || (res.status === 429 ? 'rate limited' : 'not found'), ...(final ? {} : { retry: true }) };
      if (final) return last;
      if (transient || body.error) continue;
      return last;
    }
    const status = body.result.status || {};
    const failure = Object.prototype.hasOwnProperty.call(status, 'Failure');
    return { hash, found: true, success: !failure && (Object.prototype.hasOwnProperty.call(status, 'SuccessValue') || Object.prototype.hasOwnProperty.call(status, 'SuccessReceiptId')), failure, signer: tx.signer_id || sender };
  }
  return last;
}

export async function checkAll(dep, { rpc, fetchImpl = fetch, tries = 3, wait = sleep, pauseMs = 120, passes = 3 } = {}) {
  const rpcs = (Array.isArray(rpc) ? rpc : [rpc]).filter(Boolean);
  const rows = collectMainnetTxs(dep);
  // One hash can be recorded under several shops (a recovered house tx appears in
  // the retired record and the live one). Ask once, not four times, then reuse.
  const byHash = new Map();
  let asked = 0;
  const lookup = async (row) => {
    if (byHash.has(row.hash)) return byHash.get(row.hash);
    // Space the lookups out so a free RPC does not answer the burst with 429s,
    // and start each hash on the next endpoint so load spreads across the list.
    if (asked > 0 && pauseMs > 0) await wait(pauseMs);
    const order = rpcs.map((_, i) => rpcs[(i + asked) % rpcs.length]);
    asked += 1;
    let hit = { ...row, found: false, error: 'not found' };
    for (const sender of sendersFor(dep, row)) {
      for (const url of order) {
        const one = await checkTx({ hash: row.hash, sender, rpc: url, fetchImpl, tries, wait });
        hit = { ...row, ...one, sender };
        if (one.found) break;
      }
      if (hit.found) break;
    }
    if (hit.found) byHash.set(row.hash, hit);
    return hit;
  };

  const out = [];
  for (const row of rows) out.push(await lookup(row));
  // A public archival node can drop a lookup in a burst even when the tx is there:
  // the same hash came back found on one row and missing on the next in CI. Retry
  // the ones that did not resolve, with backoff, before calling them missing.
  const pending = () => out.map((r, i) => [r, i]).filter(([r]) => !r.found);
  for (let pass = 1; pass <= passes && pending().length; pass += 1) {
    await wait(400 * pass);
    for (const [, i] of pending()) {
      const again = await lookup({ ...rows[i] });
      if (again.found) out[i] = again;
      else out[i] = { ...out[i], error: again.error };
    }
  }
  return { ok: out.length > 0 && out.every(r => r.found), rows: out };
}
