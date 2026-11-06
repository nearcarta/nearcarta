#!/usr/bin/env node
// Create guard.<root>, deploy the guard wasm, and init it with the board.
// Dry-run by default. --live signs. The signer key is NEAR_MAINNET_SIGNER_KEY
// and is never printed. This file has no visitor payee, amount, or allowlist.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };

const live = process.argv.includes('--live');
const smoke = process.argv.includes('--smoke');
const BYTE = 10n ** 19n;
const SLACK = 2000n;
const GAS_CUSHION = 5n * 10n ** 22n;
const TG = 10n ** 12n;
const wasmPath = new URL('../contracts/artifacts/guard.wasm', import.meta.url);
const guardId = 'guard.' + MAIN.root;
const boardId = MAIN.board.contract;

const near = (y) => {
  const n = BigInt(y);
  const whole = n / 10n ** 24n;
  const frac = (n % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
};

let wasm = null;
try { wasm = readFileSync(wasmPath); } catch { wasm = null; }
const sha = wasm ? createHash('sha256').update(wasm).digest('hex') : null;
const stake = wasm ? (BigInt(wasm.length) + SLACK) * BYTE : null;
const needed = stake == null ? null : stake + GAS_CUSHION;

console.log('guard deploy');
console.log('mode: ' + (live ? 'live' : 'dry-run'));
console.log('wasm: ' + (wasm ? wasm.length + ' bytes' : 'missing'));
console.log('sha256: ' + (sha || 'missing'));
console.log('storage stake: ' + (stake == null ? 'missing' : stake.toString() + ' yoctoNEAR (' + near(stake) + ' NEAR)'));
console.log('storage price: 1 NEAR per 100000 bytes, plus ' + SLACK.toString() + ' bytes of state slack');
console.log(MAIN.root + ' balance needed: ' + (needed == null ? 'missing' : needed.toString() + ' yoctoNEAR (' + near(needed) + ' NEAR)'));
console.log('that is the stake transfer plus a 0.05 NEAR gas cushion that stays on ' + MAIN.root);
console.log('transfer: ' + (stake == null ? 'missing' : stake.toString() + ' yoctoNEAR') + ' to ' + guardId);
console.log('payee: ' + guardId);
console.log('no other transfer');

async function viewAccount(id) {
  const r = await fetch(MAIN.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: id } }),
  });
  const j = await r.json();
  if (j.error) {
    const missing = /UNKNOWN_ACCOUNT|does not exist/i.test(JSON.stringify(j.error));
    return { missing, error: missing ? null : j.error };
  }
  return { missing: false, amount: j.result.amount, code_hash: j.result.code_hash };
}

function step(n, title) { console.log('step ' + n + ': ' + title); }

const smokePayee = process.env.SMOKE_PAYEE || '';
const smokeAmount = process.env.SMOKE_YOCTO || '1';
if (!/^[0-9]+$/.test(smokeAmount)) {
  console.error('SMOKE_YOCTO must be a yocto integer.');
  process.exit(1);
}

step(1, 'pre-check wasm');
console.log(wasm ? 'wasm is present' : 'wasm is missing. Build contracts/guard and copy the release wasm to contracts/artifacts/guard.wasm');
step(2, 'pre-check ' + guardId + ' does not exist yet');
step(3, 'pre-check ' + boardId + ' exists');
step(4, 'pre-check ' + MAIN.root + ' balance covers the stake and the gas cushion');
step(5, 'create ' + guardId + ', transfer the stake, deploy the wasm, call new');
console.log('new args: {"board":"' + boardId + '"}');
step(6, 'post-deploy view get_config on ' + guardId);
step(7, 'smoke propose_call_as pay, hold false, amount ' + smokeAmount + ' yoctoNEAR');
console.log('smoke payee: ' + (smokePayee || 'unset. Set SMOKE_PAYEE to the signer\'s own account. This script does not choose one.'));
console.log('smoke is not sent in a dry-run');

let guardAccount = null;
let boardAccount = null;
let rootAccount = null;
try {
  guardAccount = await viewAccount(guardId);
  boardAccount = await viewAccount(boardId);
  rootAccount = await viewAccount(MAIN.root);
} catch (e) {
  console.log('pre-check view failed: ' + (e?.message || e));
}
if (guardAccount) console.log(guardId + ': ' + (guardAccount.missing ? 'does not exist' : 'already exists'));
if (boardAccount) console.log(boardId + ': ' + (boardAccount.missing ? 'MISSING' : 'exists'));
if (rootAccount && rootAccount.amount != null && needed != null) {
  const have = BigInt(rootAccount.amount);
  console.log(MAIN.root + ' balance: ' + have.toString() + ' yoctoNEAR (' + near(have) + ' NEAR)');
  console.log(have >= needed ? 'balance covers the deploy' : 'balance is short of the deploy');
}

if (!live) {
  console.log('This command does not sign and does not send NEAR.');
  process.exit(wasm ? 0 : 1);
}

const key = process.env.NEAR_MAINNET_SIGNER_KEY || '';
if (!key.startsWith('ed25519:')) {
  console.error('Refusing to sign: set NEAR_MAINNET_SIGNER_KEY to the ed25519 secret of ' + MAIN.root + '. This script does not read a key file.');
  process.exit(1);
}
if (!wasm) {
  console.error('Refusing to sign: the wasm is missing.');
  process.exit(1);
}
if (!guardAccount || guardAccount.error || !boardAccount || boardAccount.missing) {
  console.error('Refusing to sign: a pre-check view failed.');
  process.exit(1);
}
if (!guardAccount.missing) {
  console.error('Refusing to sign: ' + guardId + ' already exists.');
  process.exit(1);
}

const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
const signer = new Account(MAIN.root, new JsonRpcProvider({ url: MAIN.rpc }), KeyPairSigner.fromSecretKey(key));
const send = async (receiverId, actions) => {
  const r = await signer.signAndSendTransaction({ receiverId, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const bad = r.status?.Failure || r.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
  console.log((bad ? 'FAILED ' : 'OK ') + r.transaction.hash + (bad ? ' ' + JSON.stringify(bad).slice(0, 180) : ''));
  if (bad) process.exit(1);
  return r.transaction.hash;
};

await send(guardId, [
  A.createAccount(),
  A.transfer(stake),
  A.deployContract(new Uint8Array(wasm)),
  A.functionCall('new', { board: boardId }, 30n * TG, 0n),
]);

const raw = await signer.provider.query({
  request_type: 'call_function', finality: 'final', account_id: guardId, method_name: 'get_config', args_base64: Buffer.from('{}').toString('base64'),
});
console.log('get_config: ' + Buffer.from(raw.result).toString());

if (smoke) {
  if (!smokePayee) {
    console.error('Refusing the smoke payment: set SMOKE_PAYEE to the signer\'s own account.');
    process.exit(1);
  }
  console.log('smoke payment is a visitor row call, not a transfer from ' + MAIN.root);
  console.log('amount: ' + smokeAmount + ' yoctoNEAR');
  console.log('payee: ' + smokePayee);
  console.log('method: propose_call_as hold false, then guard.pay');
  console.log('This script does not send that payment. The visitor row sends it, inside that row\'s cap.');
}
console.log('reap() with 1 yocto from ' + MAIN.root + ' deletes ' + guardId + ' and returns the stake. Not sent.');
console.log('After a live run, the owner records it in shared/deployments/mainnet.json:');
console.log('"guard": { "contract": "' + guardId + '", "owner": "' + MAIN.root + '", "status": "deployed", "crate": "contracts/guard", "wasm": "contracts/artifacts/guard.wasm", "wasm_sha256": "' + (sha || '') + '", "storage_bytes": ' + (wasm ? wasm.length : 0) + ', "deploy_tx": "<hash>" }');
console.log('This script does not edit that file.');
