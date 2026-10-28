// Deletes the last full-access key on the three retired testnet accounts (old Toll oath, old Town Hall
// oath, arena3). After this no one can change their code or state outside the contract's own methods.
// Keys are read from .secrets/ and never printed. Testnet only.
// Usage: SECRETS=/path/to/.secrets node backend/scripts/retire-legacy-keys.js
import { readFileSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPairSigner, actions } from 'near-api-js';

const rpc = process.env.NEAR_RPC || 'https://rpc.testnet.near.org';
if (!/testnet|:\/\/test\./.test(rpc)) { console.error('testnet only'); process.exit(2); }
const provider = new JsonRpcProvider({ url: rpc });
const S = process.env.SECRETS;
const pick = (file, path) => path.reduce((o, k) => o[k], JSON.parse(readFileSync(`${S}/${file}`, 'utf8')));
const LEGACY = [
  ['r4-oath-full.json', []],
  ['r7-testnet-run2.json', ['oath']],
  ['r6-testnet.json', ['arena3']],
];
for (const [file, path] of LEGACY) {
  const k = pick(file, path);
  if (!k.account_id.endsWith('.testnet')) throw new Error('not a testnet account');
  const signer = KeyPairSigner.fromSecretKey(k.private_key);
  const pub = (await signer.getPublicKey()).toString();
  const keys = (await provider.query({ request_type: 'view_access_key_list', finality: 'final', account_id: k.account_id })).keys;
  const fa = keys.filter(x => x.access_key.permission === 'FullAccess').map(x => x.public_key);
  if (!fa.includes(pub)) { console.log(k.account_id, 'key already gone; full-access keys now', fa.length); continue; }
  const acc = new Account(k.account_id, provider, signer);
  const r = await acc.signAndSendTransaction({ receiverId: k.account_id, actions: [actions.deleteKey(await signer.getPublicKey())], waitUntil: 'FINAL' });
  const fail = r.status?.Failure;
  if (fail) throw new Error(JSON.stringify(fail));
  const after = (await provider.query({ request_type: 'view_access_key_list', finality: 'final', account_id: k.account_id })).keys;
  console.log(k.account_id, 'delete_key', r.transaction.hash, 'full-access keys now', after.filter(x => x.access_key.permission === 'FullAccess').length);
}
