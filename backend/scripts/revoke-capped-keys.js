// Revoke agent keys that still carry a gas allowance on charters that are now history (testnet only).
// A capped key is locked out for good once its gas runs out, so the live runner moved to R18 keys with no allowance;
// this deletes the old capped keys through the charter's own owner-only revoke_agent (instant, tightening).
// Usage: PAIRS=<charter>=<owner key json>,... OUT=judges/proofs/revoke-capped-keys.json node backend/scripts/revoke-capped-keys.js
import { readFileSync, writeFileSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const provider = new JsonRpcProvider({ url: cfg.rpc });
const keys = async id => (await provider.query({ request_type: 'view_access_key_list', finality: 'final', account_id: id })).keys;
const capped = ks => ks.filter(k => k.access_key.permission.FunctionCall?.allowance != null).length;
const out = [];
for (const pair of process.env.PAIRS.split(',')) {
  const [charter, file] = pair.split('=');
  const k = JSON.parse(readFileSync(file, 'utf8')); k.account_id ||= file.split('/').pop().replace(/\.json$/, '');
  const before = capped(await keys(charter));
  const rec = { charter, owner: k.account_id, capped_before: before };
  if (before) {
    const r = await new Account(k.account_id, provider, KeyPairSigner.fromSecretKey(k.private_key))
      .signAndSendTransaction({ receiverId: charter, actions: [A.functionCall('revoke_agent', {}, 30n * 10n ** 12n, 0n)], waitUntil: 'FINAL', throwOnFailure: false });
    const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
    rec.tx = r.transaction.hash; rec.ok = !bad; if (bad) rec.error = JSON.stringify(bad).slice(0, 200);
  }
  rec.capped_after = capped(await keys(charter));
  console.log(JSON.stringify(rec)); out.push(rec);
}
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ checked_at: new Date().toISOString(), rows: out }, null, 1) + '\n');
