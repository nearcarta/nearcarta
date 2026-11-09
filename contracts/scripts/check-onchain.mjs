#!/usr/bin/env node
// Each artifact in contracts/deployed.json must hash to its account's code on mainnet.
// With --rebuilt DIR, DIR/<account>.wasm (a rebuild from source) must match too.
// Prints one JSON line per contract and exits 1 on any mismatch. Reads public RPC only.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const RPCS = (process.env.NEAR_RPC || 'https://free.rpc.fastnear.com,https://rpc.mainnet.near.org').split(',');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(buf) {
  let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; out = '1' + out; }
  return out;
}
export const codeHash = (bytes) => base58(createHash('sha256').update(bytes).digest());

async function rpc(params) {
  let last;
  for (const url of RPCS) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }) });
        const j = await r.json();
        if (j.result) return j.result;
        last = new Error(JSON.stringify(j.error || j));
        if (String(last.message).includes('UNKNOWN_ACCOUNT')) throw last;
      } catch (e) { last = e; }
      await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
    }
  }
  throw last;
}
export async function onchainHash(account) {
  const r = await rpc({ request_type: 'view_account', finality: 'final', account_id: account });
  return r.code_hash;
}
export async function sourceMetadata(account) {
  try {
    const r = await rpc({ request_type: 'call_function', finality: 'final', account_id: account,
      method_name: 'contract_source_metadata', args_base64: '' });
    return JSON.parse(Buffer.from(r.result).toString());
  } catch { return null; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = JSON.parse(readFileSync(new URL('../deployed.json', import.meta.url)));
  const at = process.argv.indexOf('--rebuilt');
  const rebuilt = at > 0 ? process.argv[at + 1] : null;
  let bad = 0;
  for (const c of manifest.contracts) {
    const live = await onchainHash(c.account);
    const art = codeHash(readFileSync(new URL('../../' + c.artifact, import.meta.url)));
    const row = { account: c.account, onchain: live, artifact: art, artifact_ok: art === live, build: c.build };
    if (rebuilt && c.build !== 'none') {
      const f = `${rebuilt}/${c.account}.wasm`;
      row.rebuilt = existsSync(f) ? codeHash(readFileSync(f)) : null;
      row.rebuilt_ok = row.rebuilt === live;
      if (!row.rebuilt_ok) bad++;
    }
    if (c.build === 'none') row.reason = c.reason;
    if (!row.artifact_ok) bad++;
    console.log(JSON.stringify(row));
  }
  if (bad) { console.error(`${bad} mismatch(es)`); process.exit(1); }
}
