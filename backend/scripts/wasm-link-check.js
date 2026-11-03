// Proves a wasm links on a network: deploys it to a throwaway subaccount, makes a view call, deletes the account back to the root.
// Usage: NET=mainnet ROOT_ID=<root> ROOT_KEY=<json> WASM=<file> SUB=<label> [VIEW=owner] node backend/scripts/wasm-link-check.js
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';
const E = process.env, rpc = { mainnet: 'https://free.rpc.fastnear.com', testnet: 'https://rpc.testnet.fastnear.com' }[E.NET];
const provider = new JsonRpcProvider({ url: rpc });
const rk = JSON.parse(readFileSync(E.ROOT_KEY, 'utf8'));
const root = new Account(E.ROOT_ID, provider, KeyPairSigner.fromSecretKey(rk.private_key || rk.secret_key));
const code = readFileSync(E.WASM), id = `${E.SUB}.${E.ROOT_ID}`, kp = KeyPair.fromRandom('ed25519');
const amt = BigInt(Math.ceil((code.length + 600) / 1e5 * 1e6 + 50000)) * 10n ** 18n;
const tx = async (a, r, acts) => { const o = await a.signAndSendTransaction({ receiverId: r, actions: acts, waitUntil: 'FINAL', throwOnFailure: false }); const bad = o.status.Failure || o.receipts_outcome.find(x => x.outcome.status.Failure)?.outcome.status.Failure; return { tx: o.transaction.hash, ok: !bad, error: bad ? JSON.stringify(bad).slice(0, 200) : undefined }; };
const out = { wasm: E.WASM, sha256: crypto.createHash('sha256').update(code).digest('hex'), bytes: code.length, account: id };
out.create_deploy = await tx(root, id, [A.createAccount(), A.transfer(amt), A.addFullAccessKey(kp.getPublicKey()), A.deployContract(code)]);
if (out.create_deploy.ok) {
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: id, method_name: E.VIEW || 'owner', args_base64: '' } }) }).then(r => r.json());
  const msg = JSON.stringify(r.error || r.result?.error || 'ok');
  out.view = { method: E.VIEW || 'owner', link_error: /Link|invalid import|PrepareError/i.test(msg), result: msg.slice(0, 200) };
  const sub = new Account(id, provider, KeyPairSigner.fromSecretKey(kp.toString()));
  out.delete = await tx(sub, id, [A.deleteAccount(E.ROOT_ID)]);
}
console.log(JSON.stringify(out, null, 1));
