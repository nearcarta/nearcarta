// Read-only: for every testnet account named in shared/deployments/testnet.json that holds contract
// code, list its access keys from RPC and count full-access keys (FAK). Writes judges/proofs/access-keys.json.
// Usage: node backend/scripts/access-keys.js   (testnet only, no keys needed)
import { writeFileSync } from 'node:fs';
import { DEP } from '../src/config.js';

const RPCS = ['https://test.rpc.fastnear.com', 'https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'];
const EMPTY = '11111111111111111111111111111111';
// Accounts that hold code but are not contracts this project runs. role: external (operated by NEAR) or
// wallet (a signer account; a wallet needs a full-access key to sign).
const ROLE = {
  'v1.signer-prod.testnet': ['external', 'NEAR testnet MPC signer (Chain Signatures), operated by NEAR, not by this project'],
  'r6vamvr9brhx-arena2.testnet': ['wallet', 'Owner (signer) account of the arena, not a contract the app calls. It still carries an older arena build from an earlier run; nothing in backend/src or app/src calls it. The live arena is arena.r6vamvr9brhx-arena2.testnet, which never had a key'],
};

async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'curl/8' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
      return j.result;
    } catch (e) { last = e; }
  }
  throw last;
}

const ids = new Set();
(function walk(v) {
  if (typeof v === 'string') { if (/^([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*\.testnet$/.test(v)) ids.add(v); }
  else if (v && typeof v === 'object') Object.values(v).forEach(walk);
})(DEP);

const rows = [];
for (const id of [...ids].sort()) {
  let acc;
  try { acc = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: id }); }
  catch { continue; }
  if (acc.code_hash === EMPTY) continue;
  const keys = (await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: id })).keys;
  const fak = keys.filter((k) => k.access_key.permission === 'FullAccess').length;
  const fc = keys.filter((k) => k.access_key.permission !== 'FullAccess').map((k) => ({
    receiver_id: k.access_key.permission.FunctionCall.receiver_id,
    method_names: k.access_key.permission.FunctionCall.method_names,
  }));
  rows.push({ account: id, code_hash: acc.code_hash, block_height: acc.block_height, full_access_keys: fak,
    function_call_keys: fc, role: ROLE[id]?.[0] || 'contract', ...(ROLE[id] ? { note: ROLE[id][1] } : {}) });
}
const out = { checked_at: new Date().toISOString(), source: 'view_account + view_access_key_list, finality final, testnet RPC',
  contracts: rows.filter((r) => r.role === 'contract').length,
  contracts_with_full_access_key: rows.filter((r) => r.role === 'contract' && r.full_access_keys > 0).map((r) => r.account),
  not_our_contracts: rows.filter((r) => r.role !== 'contract').map((r) => ({ account: r.account, role: r.role, full_access_keys: r.full_access_keys })), rows };
writeFileSync(new URL('../../judges/proofs/access-keys.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
for (const r of rows) console.log(String(r.full_access_keys).padStart(2), 'FAK', String(r.function_call_keys.length).padStart(2), 'FC ', r.account, r.role);
console.log('our contracts with a full-access key:', out.contracts_with_full_access_key.length);
