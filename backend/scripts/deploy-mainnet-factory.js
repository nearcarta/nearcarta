// Deploy the recoverable mainnet charter factory from nearcarta.near.
// Dry by default: prints the plan and does not sign. The owner runs it.
//
//   node backend/scripts/deploy-mainnet-factory.js
//   NEAR_MAINNET_SIGNER_KEY='ed25519:...' node backend/scripts/deploy-mainnet-factory.js --live
//
// The key is read from the environment only. It is never printed and never read from a file.
// --live does not edit shared/deployments/mainnet.json. After the transactions succeed, set
// factory.status to "deployed" and factory.min_deposit_yocto to the printed value.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { factoryFundYocto, minDepositYocto, STATE_SLACK_BYTES } from '../../shared/factory/lock.js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

const live = process.argv.includes('--live');
const factory = MAIN.factory;
if (!factory?.contract || !factory.oath_wasm) {
  console.error('mainnet.json factory.contract and factory.oath_wasm are required');
  process.exit(1);
}
const root = new URL('../../', import.meta.url);
const oathPath = new URL(factory.oath_wasm, root);
const wasmPath = new URL('contracts/charter_factory_lock/target/near/charter_factory_lock.wasm', root);
const oath = existsSync(oathPath) ? readFileSync(oathPath) : null;
const built = existsSync(wasmPath) ? readFileSync(wasmPath) : null;
const sha = b => createHash('sha256').update(b).digest('hex');
const near = y => (Number(y / 10n ** 18n) / 1e6).toFixed(5);

if (!oath) {
  console.error('Missing oath wasm at ' + factory.oath_wasm);
  process.exit(1);
}
const min = minDepositYocto(oath.length);
const fund = factoryFundYocto(built ? built.length : 200_000, oath.length);
console.log('Factory account: ' + factory.contract);
console.log('Owner: ' + MAIN.root);
console.log('Oath wasm: ' + factory.oath_wasm + ' (' + oath.length + ' bytes, sha256 ' + sha(oath) + ')');
console.log('State slack: ' + STATE_SLACK_BYTES + ' bytes');
console.log('Visitor min deposit: ' + min.toString() + ' yoctoNEAR (' + near(min) + ' NEAR), returned when that charter is reaped');
console.log('Factory funding: ' + fund.toString() + ' yoctoNEAR (' + near(fund) + ' NEAR), returned when the factory is reaped');
console.log('Factory wasm: ' + (built ? wasmPath.pathname + ' (' + built.length + ' bytes)' : 'not built yet. From contracts/charter_factory_lock run: cargo +1.95.0 near build non-reproducible-wasm'));
console.log('Teardown: docs/MAINNET_FACTORY.md');
if (!live) {
  console.log('This command does not sign and does not send NEAR.');
  process.exit(0);
}

const key = process.env.NEAR_MAINNET_SIGNER_KEY || '';
if (!key.startsWith('ed25519:')) {
  console.error('Refusing to sign: set NEAR_MAINNET_SIGNER_KEY to the ed25519 secret of ' + MAIN.root + '. This script does not read a key file.');
  process.exit(1);
}
if (!built) {
  console.error('Refusing to sign: build the factory wasm first.');
  process.exit(1);
}

const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
const signer = new Account(MAIN.root, new JsonRpcProvider({ url: MAIN.rpc }), KeyPairSigner.fromSecretKey(key));
const TG = 10n ** 12n;
const exists = async (id) => {
  try { await signer.provider.query({ request_type: 'view_account', finality: 'final', account_id: id }); return true; }
  catch { return false; }
};
const send = async (receiverId, actions) => {
  const r = await signer.signAndSendTransaction({ receiverId, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const bad = r.status?.Failure || r.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
  console.log((bad ? 'FAILED ' : 'OK ') + r.transaction.hash + (bad ? ' ' + JSON.stringify(bad).slice(0, 180) : ''));
  if (bad) process.exit(1);
  return r.transaction.hash;
};

if (!(await exists(factory.contract))) {
  await send(factory.contract, [
    A.createAccount(),
    A.transfer(fund),
    A.deployContract(built),
    A.functionCall('new', { owner: MAIN.root }, 80n * TG, 0n),
  ]);
}
const codeStake = BigInt(oath.length + 64) * 10n ** 19n;
await send(factory.contract, [
  A.functionCall('set_code', new Uint8Array(oath), 300n * TG, codeStake),
]);
console.log('Set factory.status to "deployed" and factory.min_deposit_yocto to "' + min.toString() + '" in shared/deployments/mainnet.json.');
