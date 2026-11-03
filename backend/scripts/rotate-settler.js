// Rotate the toll gate settler key on the gate owner account (testnet only). Step 1 (default): add a new
// FunctionCall key with the old key's receiver, methods and allowance, and write it to NEW_OUT (mode 600).
// Step 2 (DELETE_OLD=1, after TOLL_SETTLER_KEY points at the new key): delete the old key.
// Keys are read from files only and never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';
if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env, provider = new JsonRpcProvider({ url: cfg.rpc });
const OWN = JSON.parse(readFileSync(E.OWNER_KEY, 'utf8')), OLD = JSON.parse(readFileSync(E.OLD_KEY, 'utf8'));
const owner = new Account(OWN.account_id, provider, KeyPairSigner.fromSecretKey(OWN.private_key));
const keys = (await provider.query({ request_type: 'view_access_key_list', finality: 'final', account_id: OWN.account_id })).keys;
const old = keys.find(k => k.public_key === OLD.public_key);
const fin = async (step, actions) => { const r = await owner.signAndSendTransaction({ receiverId: OWN.account_id, actions, waitUntil: 'FINAL' }); console.log(JSON.stringify({ step, tx: r.transaction.hash, ok: !r.status.Failure })); return r.transaction.hash; };
if (E.DELETE_OLD) {
  if (!old) { console.log('old key already gone'); process.exit(0); }
  await fin('delete_old_settler_key', [A.deleteKey(KeyPair.fromString(OLD.private_key).getPublicKey())]);
} else {
  const fc = old?.access_key.permission.FunctionCall;
  if (!fc) { console.error('old settler key not found as a FunctionCall key'); process.exit(3); }
  const kp = KeyPair.fromRandom('ed25519');
  writeFileSync(E.NEW_OUT, JSON.stringify({ account_id: OWN.account_id, public_key: kp.getPublicKey().toString(), private_key: kp.toString(), receiver: fc.receiver_id, methods: fc.method_names }, null, 1), { mode: 0o600 });
  const tx = await fin('add_new_settler_key', [A.addFunctionCallAccessKey(kp.getPublicKey(), fc.receiver_id, fc.method_names, fc.allowance == null ? undefined : BigInt(fc.allowance))]);
  console.log(JSON.stringify({ new_public_key: kp.getPublicKey().toString(), receiver: fc.receiver_id, methods: fc.method_names, allowance: fc.allowance, tx }));
}
process.exit(0);
