#!/usr/bin/env node
// Does the live Toll contract export the foreign signer House needs?
// Read-only: view_code and view calls only. No key, no broadcast.
//
//   node scripts/house-foreign-check.js
//
// Exit 0 when Toll exports sign_effect, 1 when it does not (House stays live:false),
// 2 when the account could not be read. The interface is docs/internal/house-foreign-signer.md.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { FOREIGN_SIGNER_METHOD, FOREIGN_SIGNER_VERSION } from '../app/src/house-foreign.js';
import { wasmExports } from './house-recover.js';
import { HOUSE_LEGACY, HOUSE_OWNER, HOUSE_SHOP } from '../shared/house/shop.js';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };

const TOLL = MAIN.toll?.contract || '';

async function rpc(method, params) {
  const res = await fetch(MAIN.rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
  return body.result;
}

async function viewCall(account, method, args) {
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  return JSON.parse(Buffer.from(r.result).toString());
}

export function report({ toll, codeHash, exports }) {
  const ready = exports.includes(FOREIGN_SIGNER_METHOD);
  return {
    interface_version: FOREIGN_SIGNER_VERSION,
    method: FOREIGN_SIGNER_METHOD,
    toll,
    code_hash: codeHash,
    exports,
    ready,
    house: { shop: HOUSE_SHOP, owner: HOUSE_OWNER, legacy: HOUSE_LEGACY },
    live: ready,
    why: ready
      ? `${toll} exports ${FOREIGN_SIGNER_METHOD}; House may mark a vault live once the house contract calls it`
      : `${toll} does not export ${FOREIGN_SIGNER_METHOD}; every house vault stays live:false and no address is claimed as controlled`,
  };
}

async function main() {
  if (!TOLL) { console.error('no toll.contract in mainnet.json'); process.exit(2); }
  let code;
  try { code = await rpc('query', { request_type: 'view_code', finality: 'final', account_id: TOLL }); }
  catch (e) { console.error('could not read ' + TOLL + ': ' + e.message); process.exit(2); }
  const wasm = Buffer.from(code.code_base64 || '', 'base64');
  const out = report({ toll: TOLL, codeHash: code.code_hash, exports: wasmExports(wasm) });
  console.log(JSON.stringify({ ...out, wasm_sha256: createHash('sha256').update(wasm).digest('hex'), wasm_bytes: wasm.length }, null, 2));
  // The house side of the path, for the record. No address is printed: the signer owns derivation.
  try {
    const policy = await viewCall(TOLL, 'policy', {});
    console.log('toll policy path: ' + (policy?.path || 'unread') + ', mpc ' + (policy?.mpc || 'unread'));
  } catch { console.log('toll policy: unread'); }
  process.exit(out.ready ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch(e => { console.error(String(e?.message || e)); process.exit(2); });
