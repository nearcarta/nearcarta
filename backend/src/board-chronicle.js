// A visitor's propose feed on the mainnet board. Nearblocks lists the account;
// each row is filled from RPC, including the on_paid receipt. Cached per owner.
import { cfg } from './config.js';
import { BOARD, judgePropose, loadTx } from './board-tx.js';

const NEARBLOCKS = 'https://api.nearblocks.io/v1/account/';
const cache = new Map();
const TTL = 20_000;
let fetchImpl = globalThis.fetch;
export const _setFetch = fn => { fetchImpl = fn || globalThis.fetch; };
export const _clear = () => cache.clear();

function rowFrom(judged, hash, at) {
  return {
    hash, at: at || null, shop: 'chronicle', method: 'propose',
    signer: judged.signer, payee: judged.payee, amount: judged.amount,
    on_paid: judged.on_paid, network: 'mainnet',
    url: `https://nearblocks.io/txns/${hash}`,
  };
}

async function nearblocksHashes(owner, fetchFn) {
  const res = await fetchFn(`${NEARBLOCKS}${encodeURIComponent(owner)}/txns?per_page=25`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`nearblocks http ${res.status}`);
  const j = await res.json();
  const list = j.txns || j.txns_list || [];
  return list.filter(t => (t.receiver_account_id || t.receiver_id) === BOARD && (t.actions || []).some(a => (a.method || a.method_name) === 'propose'))
    .map(t => ({ hash: t.transaction_hash || t.hash, at: t.block_timestamp ? new Date(Number(String(t.block_timestamp).slice(0, 13))).toISOString() : null }))
    .filter(t => t.hash);
}

export async function mainnetChronicle({ owner, known = [], limit = 12, rpc = cfg.mainnetRpc, fetchFn = fetchImpl, now = Date.now() } = {}) {
  const key = owner + '|' + known.join(',');
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL) return hit.v;
  const hashes = [];
  let source = 'nearblocks account txns + mainnet RPC';
  try {
    for (const h of await nearblocksHashes(owner, fetchFn)) if (!hashes.some(x => x.hash === h.hash)) hashes.push(h);
  } catch {
    source = 'known tx hashes + mainnet RPC (nearblocks busy)';
  }
  for (const hash of known) if (!hashes.some(x => x.hash === hash)) hashes.push({ hash, at: null });
  const txs = [];
  for (const h of hashes.slice(0, limit)) {
    try {
      const tx = await loadTx(h.hash, owner, { rpc, fetchFn });
      const args = (() => { try { return JSON.parse(Buffer.from(tx.transaction.actions?.[0]?.FunctionCall?.args || '', 'base64').toString('utf8')); } catch { return {}; } })();
      const judged = judgePropose(tx, { visitor: owner, payee: args.receiver, amount: args.amount, board: BOARD });
      if (judged.ok) txs.push(rowFrom(judged, h.hash, h.at));
    } catch { /* a hash that is not this visitor's propose is skipped */ }
  }
  const v = { account: owner, board: BOARD, network: 'mainnet', count: txs.length, txs, source, entry: 'one propose of 0.001 NEAR' };
  cache.set(key, { at: now, v });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return v;
}
