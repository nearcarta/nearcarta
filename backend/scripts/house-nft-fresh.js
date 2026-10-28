// House deed NFT (NEP-171) on a fresh account: ONE batch from the funder creates deed-<t>.<funder>, funds it,
// deploys the reproducible contracts/artifacts/house_nft.wasm and calls new(). No AddKey action, so the
// contract account has no access key and its code can never change. Then: the funder mints its own deed,
// a second mint is refused, and nft_token / nft_metadata / nft_total_supply are read back.
// Usage (testnet only): FUNDER_FILE=<json with account_id, private_key> OUT=judges/proofs/house-deed.json HOUSE=<charter>
//   node backend/scripts/house-nft-fresh.js
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';
import { accessKeys } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env;
const F = JSON.parse(readFileSync(E.FUNDER_FILE, 'utf8'));
const provider = new JsonRpcProvider({ url: cfg.rpc });
const funder = new Account(F.account_id, provider, KeyPairSigner.fromSecretKey(F.private_key));
const C = E.CONTRACT || `deed-${Date.now().toString(36)}.${F.account_id}`;
const N = x => BigInt(Math.round(x * 1000)) * 10n ** 21n;
const TG = t => BigInt(t) * 10n ** 12n;
const wasm = readFileSync(new URL('../../contracts/artifacts/house_nft.wasm', import.meta.url));
const log = []; const save = () => writeFileSync(E.OUT, JSON.stringify({ contract: C, funder: F.account_id,
  wasm_sha256: crypto.createHash('sha256').update(wasm).digest('hex'), wasm_bytes: wasm.length, steps: log }, null, 1));
const outcome = (step, r) => {
  const fails = r.receipts_outcome.filter(o => o.outcome.status.Failure);
  const rec = { step, tx: r.transaction.hash, ok: !r.status.Failure && !fails.length };
  if (!rec.ok) rec.error = JSON.stringify(r.status.Failure || fails[0].outcome.status.Failure).match(/Smart contract panicked: [^"\\]+|"[A-Za-z]+Error[^}]{0,160}/)?.[0];
  const sv = r.status.SuccessValue; if (sv) rec.ret = JSON.parse(Buffer.from(sv, 'base64').toString());
  console.log(JSON.stringify({ step, ok: rec.ok, tx: rec.tx, error: rec.error })); log.push(rec); save(); return rec;
};
const send = (step, receiverId, actions) => funder.signAndSendTransaction({ receiverId, actions, waitUntil: 'FINAL', throwOnFailure: false }).then(r => outcome(step, r));
const view = async (m, a = {}) => JSON.parse(Buffer.from((await provider.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString());

const dep = await send('deploy_batch', C, [A.createAccount(), A.transfer(N(Number(E.FUND || 2.4))), A.deployContract(wasm), A.functionCall('new', {}, TG(30), 0n)]);
if (!dep.ok) process.exit(1);
const house = E.HOUSE || null;
await send('mint_deed', C, [A.functionCall('mint_deed', { house }, TG(30), N(0.02))]);
await send('mint_again_refused', C, [A.functionCall('mint_deed', { house }, TG(30), N(0.02))]);
const acct = await provider.query({ request_type: 'view_account', finality: 'final', account_id: C });
const keys = (await accessKeys(C)).keys || [];
const reads = { nft_metadata: await view('nft_metadata'), nft_total_supply: await view('nft_total_supply'),
  nft_token: await view('nft_token', { token_id: F.account_id }), code_hash: acct.code_hash, access_keys: keys.length };
console.log(JSON.stringify(reads)); log.push({ step: 'reads', ...reads }); save();
