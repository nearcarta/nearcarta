// House deed v2 (the deed IS the house): ONE batch from the funder creates deedv2-<t>.<funder>, funds it, deploys
// contracts/artifacts/house_nft.v2.wasm and calls new(). No AddKey action, so the account has no access key.
// Then the whole life of a deed on testnet: mint with a purse and a cap, a stranger funds it, the holder pays under
// the cap, over-cap and no-1-yocto pays are refused, the deed moves to a second account, the OLD holder is refused
// and the NEW holder pays from the same purse.
// Usage (testnet only): FUNDER_FILE=<json> SECOND_FILE=<json> OUT=judges/proofs/house-deed-v2.json node backend/scripts/house-deed-v2.js
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';
import { accessKeys } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env;
const provider = new JsonRpcProvider({ url: cfg.rpc });
const acct = f => { const j = JSON.parse(readFileSync(f, 'utf8')); return new Account(j.account_id, provider, KeyPairSigner.fromSecretKey(j.private_key)); };
const one = acct(E.FUNDER_FILE), two = acct(E.SECOND_FILE);
const C = E.CONTRACT || `deedv2-${Date.now().toString(36)}.${one.accountId}`;
const N = x => BigInt(Math.round(x * 1000)) * 10n ** 21n;
const TG = t => BigInt(t) * 10n ** 12n;
const wasm = readFileSync(new URL('../../contracts/artifacts/house_nft.v2.wasm', import.meta.url));
const log = []; const save = () => writeFileSync(E.OUT, JSON.stringify({ contract: C, holder1: one.accountId, holder2: two.accountId,
  wasm_sha256: crypto.createHash('sha256').update(wasm).digest('hex'), wasm_bytes: wasm.length, steps: log }, null, 1));
const outcome = (step, r, want) => {
  const fails = r.receipts_outcome.filter(o => o.outcome.status.Failure);
  const rec = { step, tx: r.transaction.hash, ok: !r.status.Failure && !fails.length };
  if (!rec.ok) rec.error = JSON.stringify(r.status.Failure || fails[0].outcome.status.Failure).match(/Smart contract panicked: [^"\\]+|"[A-Za-z]+Error[^}]{0,160}/)?.[0];
  rec.as_expected = rec.ok === want;
  console.log(JSON.stringify({ step, ok: rec.ok, as_expected: rec.as_expected, tx: rec.tx, error: rec.error })); log.push(rec); save(); return rec;
};
const send = (who, step, actions, want = true) => who.signAndSendTransaction({ receiverId: C, actions, waitUntil: 'FINAL', throwOnFailure: false }).then(r => outcome(step, r, want));
const view = async (m, a = {}) => JSON.parse(Buffer.from((await provider.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString());
const fc = (m, a, dep) => A.functionCall(m, a, TG(50), dep);
const id = one.accountId, Y = 1n, payee = E.PAYEE || two.accountId;

const dep = await one.signAndSendTransaction({ receiverId: C, actions: [A.createAccount(), A.transfer(N(Number(E.FUND || 2.5))), A.deployContract(wasm), A.functionCall('new', {}, TG(30), 0n)], waitUntil: 'FINAL', throwOnFailure: false }).then(r => outcome('deploy_batch', r, true));
if (!dep.ok) process.exit(1);
await send(one, 'mint_deed_with_purse', [fc('mint_deed', { house: E.HOUSE || null, cap: N(0.05).toString() }, N(0.12))]);
await send(two, 'stranger_funds_house', [fc('house_fund', { token_id: id }, N(0.05))]);
await send(one, 'holder_pays_under_cap', [fc('house_pay', { token_id: id, receiver_id: payee, amount: N(0.03).toString() }, Y)]);
await send(one, 'over_cap_refused', [fc('house_pay', { token_id: id, receiver_id: payee, amount: N(0.08).toString() }, Y)], false);
await send(one, 'no_yocto_refused', [fc('house_pay', { token_id: id, receiver_id: payee, amount: N(0.01).toString() }, 0n)], false);
await send(one, 'deed_transferred', [fc('nft_transfer', { receiver_id: two.accountId, token_id: id }, Y)]);
await send(one, 'old_holder_refused', [fc('house_pay', { token_id: id, receiver_id: one.accountId, amount: N(0.01).toString() }, Y)], false);
await send(two, 'new_holder_pays', [fc('house_pay', { token_id: id, receiver_id: one.accountId, amount: N(0.02).toString() }, Y)]);
const a = await provider.query({ request_type: 'view_account', finality: 'final', account_id: C });
const reads = { nft_metadata: await view('nft_metadata'), nft_token: await view('nft_token', { token_id: id }), house_purse: await view('house_purse', { token_id: id }),
  code_hash: a.code_hash, access_keys: ((await accessKeys(C)).keys || []).length };
console.log(JSON.stringify(reads)); log.push({ step: 'reads', ...reads }); save();
if (log.some(s => s.as_expected === false)) process.exit(1);
