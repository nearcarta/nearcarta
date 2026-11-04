// Re-reads every proof tx in shared/deployments/mainnet.json. Read-only. Exits 1 if one is missing.
// A refused payment still counts: the transaction is on chain and its status is Failure.
import { writeFileSync } from 'node:fs';
import { checkAll } from '../src/mainnet-verify.js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

const rpc = (process.env.MAINNET_RPC || 'https://archival-rpc.mainnet.fastnear.com,https://archival-rpc.mainnet.near.org').split(',');
const out = await checkAll(MAIN, { rpc });
writeFileSync(new URL('../../judges/proofs/mainnet-proof-check.json', import.meta.url), JSON.stringify(out, null, 2));
for (const row of out.rows) {
  const flag = !row.found ? 'MISSING' : row.failure ? 'REFUSED' : 'FOUND  ';
  console.log(flag, row.shop.padEnd(12), row.label.padEnd(36), row.hash);
}
console.log(`${out.rows.filter(r => r.found).length}/${out.rows.length} mainnet txs found`);
if (!out.ok) process.exit(1);
