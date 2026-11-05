// Deploy the multi-tenant mainnet charter board as a subaccount of nearcarta.near.
// Dry by default: prints the exact yoctoNEAR cost and does not sign.
//
//   node backend/scripts/deploy-mainnet-board.js
//   NEAR_MAINNET_SIGNER_KEY='ed25519:...' node backend/scripts/deploy-mainnet-board.js --live
//
// The key is read from the environment only. It is never printed and never read from a file.
// --live does not edit shared/deployments/mainnet.json. After the transaction succeeds,
// set board.status to "deployed".
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deployCost, MAX_DEPLOY_YOCTO } from '../../shared/board/cost.js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

const live = process.argv.includes('--live');
const board = MAIN.board;
if (!board?.contract || !board.wasm || board.owner !== MAIN.root) {
  console.error('mainnet.json board.contract, board.wasm and board.owner are required');
  process.exit(1);
}
const wasmPath = new URL('../../' + board.wasm, import.meta.url);
if (!existsSync(wasmPath)) {
  console.error('Missing board wasm at ' + board.wasm);
  process.exit(1);
}
const wasm = readFileSync(wasmPath);
const sha = createHash('sha256').update(wasm).digest('hex');
const cost = deployCost(wasm.length, MAIN.root);
const near = y => (Number(y / 10n ** 18n) / 1e6).toFixed(5);

console.log('Board account: ' + board.contract);
console.log('Owner: ' + MAIN.root);
console.log('Wasm: ' + board.wasm + ' (' + wasm.length + ' bytes, sha256 ' + sha + ')');
console.log('Storage bytes: ' + cost.storageBytes.toString());
console.log('Storage stake: ' + cost.stakeYocto.toString() + ' yoctoNEAR (' + near(cost.stakeYocto) + ' NEAR), returned by reap');
console.log('Account creation: ' + cost.accountCreationYocto.toString() + ' yoctoNEAR, burned');
console.log('Gas: ' + cost.gas.toString() + ' units');
console.log('Burned gas: ' + cost.burnedGasYocto.toString() + ' yoctoNEAR');
console.log('Prepaid gas: ' + cost.prepaidYocto.toString() + ' yoctoNEAR, the difference is refunded');
console.log('Total: ' + cost.totalYocto.toString() + ' yoctoNEAR (' + near(cost.totalYocto) + ' NEAR)');
console.log('Peak: ' + cost.peakYocto.toString() + ' yoctoNEAR (' + near(cost.peakYocto) + ' NEAR)');
console.log('Cap: ' + MAX_DEPLOY_YOCTO.toString() + ' yoctoNEAR (1.2 NEAR)');
console.log('Teardown: docs/MAINNET_BOARD.md');
if (cost.totalYocto > MAX_DEPLOY_YOCTO || cost.peakYocto > MAX_DEPLOY_YOCTO) {
  console.error('Refusing: the plan is over 1.2 NEAR.');
  process.exit(1);
}
if (!live) {
  console.log('This command does not sign and does not send NEAR.');
  process.exit(0);
}

const key = process.env.NEAR_MAINNET_SIGNER_KEY || '';
if (!key.startsWith('ed25519:')) {
  console.error('Refusing to sign: set NEAR_MAINNET_SIGNER_KEY to the ed25519 secret of ' + MAIN.root + '. This script does not read a key file.');
  process.exit(1);
}

const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
const signer = new Account(MAIN.root, new JsonRpcProvider({ url: MAIN.rpc }), KeyPairSigner.fromSecretKey(key));
const exists = async (id) => {
  try { await signer.provider.query({ request_type: 'view_account', finality: 'final', account_id: id }); return true; }
  catch { return false; }
};
if (await exists(board.contract)) {
  console.error(board.contract + ' already exists. This script does not redeploy it.');
  process.exit(1);
}
const TG = 10n ** 12n;
const r = await signer.signAndSendTransaction({
  receiverId: board.contract,
  waitUntil: 'FINAL',
  throwOnFailure: false,
  actions: [
    A.createAccount(),
    A.transfer(cost.stakeYocto),
    A.deployContract(new Uint8Array(wasm)),
    A.functionCall('new', {}, 30n * TG, 0n),
  ],
});
const bad = r.status?.Failure || r.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
console.log((bad ? 'FAILED ' : 'OK ') + r.transaction.hash + (bad ? ' ' + JSON.stringify(bad).slice(0, 180) : ''));
if (bad) process.exit(1);
console.log('Set board.status to "deployed" in shared/deployments/mainnet.json.');
