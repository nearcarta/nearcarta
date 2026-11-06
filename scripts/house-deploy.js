#!/usr/bin/env node
// Create the successor house shop and deploy the contract onto it.
// The legacy shop has no access key, so this does not touch it.
// Dry-run by default. --live signs. The signer key is read from NEAR_MAINNET_SIGNER_KEY
// and is never printed.
//
//   node scripts/house-deploy.js
//   NEAR_MAINNET_SIGNER_KEY='ed25519:...' node scripts/house-deploy.js --live
//
// The transfer is from the owner to the new shop only. The owner's balance is read
// at run time. The board v2 migration is expected to return about 4.37 NEAR to that
// owner; that figure is printed as an expectation, not as a measured balance.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ACCOUNT_BYTES, ACCOUNT_CREATION_YOCTO, BYTE_YOCTO, GAS_PRICE_YOCTO, GAS_PURCHASE_YOCTO, deployGas,
} from '../shared/board/cost.js';
import { HOUSE_LEGACY, HOUSE_OWNER, HOUSE_SHOP } from '../shared/house/shop.js';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };

export const HOUSE_STATE_SLACK = 2048n;
export const BOARD_V2_RETURN_NEAR = '4.37';
const WASM_REL = 'contracts/house_nft/target/wasm32-unknown-unknown/release/house_nft.wasm';

export function nearOf(yocto) {
  const v = BigInt(yocto);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 10n ** 24n;
  const frac = (abs % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '');
  const text = frac ? `${whole}.${frac}` : whole.toString();
  return neg ? `-${text}` : text;
}

export function yoctoOfNear(text) {
  const raw = String(text).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error('near amount');
  const [whole, frac = ''] = raw.split('.');
  return BigInt(whole) * 10n ** 24n + BigInt((frac + '0'.repeat(24)).slice(0, 24));
}

/**
 * Stake and the one transfer for a fresh subaccount.
 * The state slack covers the empty NFT metadata and map prefixes. The live shop
 * was 1,208 bytes past its wasm. Unused slack stays liquid on the new account.
 * @param {{
 *   shop: string, owner: string, legacy: string, wasmBytes: number, wasmSha256: string,
 *   ownerBalanceYocto: string, shopExists: boolean, argBytes?: number,
 * }} input
 */
export function planSuccessor(input) {
  const shop = input.shop;
  const owner = input.owner;
  const legacy = input.legacy;
  if (!shop || !owner || !legacy) throw new Error('shop, owner and legacy are required');
  if (shop === legacy) throw new Error('the successor is a new account');
  const wasmBytes = BigInt(input.wasmBytes);
  if (wasmBytes <= 0n) throw new Error('wasm length');
  const args = JSON.stringify({ owner });
  const argBytes = BigInt(input.argBytes ?? args.length);
  const storage = ACCOUNT_BYTES + wasmBytes + HOUSE_STATE_SLACK;
  const stake = storage * BYTE_YOCTO;
  const gas = deployGas(wasmBytes, argBytes);
  const prepaid = gas * GAS_PURCHASE_YOCTO;
  const burned = gas * GAS_PRICE_YOCTO;
  const balance = BigInt(input.ownerBalanceYocto);
  const peak = stake + prepaid;
  const returned = yoctoOfNear(BOARD_V2_RETURN_NEAR);
  const afterReturn = balance + returned;
  const transfer = {
    kind: 'fund',
    from: owner,
    payee: shop,
    amountYocto: stake.toString(),
    why: 'create the successor and stake its storage. The legacy shop is not a source and is not a payee.',
  };
  if (transfer.payee !== shop || transfer.from !== owner) throw new Error('funding parties');
  const steps = [
    { step: 'read the owner balance', pre: `${owner} holds ${nearOf(balance)} NEAR now`, ok: true },
    { step: 'successor is absent', pre: input.shopExists ? `${shop} already exists; this script does not redeploy it` : `${shop} is not on chain`, ok: !input.shopExists },
    { step: 'owner covers the peak', pre: balance >= peak ? 'the balance covers the stake and the prepaid gas' : `short by ${nearOf(peak - balance)} NEAR before the expected board return`, ok: balance >= peak },
    { step: 'expected board return', pre: `about ${BOARD_V2_RETURN_NEAR} NEAR back to ${owner} would leave ${nearOf(afterReturn)} NEAR. That covers the peak: ${afterReturn >= peak ? 'yes' : 'no'}`, ok: afterReturn >= peak },
    { step: 'create, transfer, deploy, new', pre: `one transaction from ${owner}. new owner is ${owner}. wasm ${wasmBytes} bytes, sha256 ${input.wasmSha256}`, ok: !!input.wasmSha256 && !input.shopExists && balance >= peak },
  ];
  return {
    shop,
    owner,
    legacy,
    wasmBytes: Number(wasmBytes),
    wasmSha256: input.wasmSha256,
    initArgs: args,
    storageBytes: storage.toString(),
    stateSlackBytes: HOUSE_STATE_SLACK.toString(),
    stakeYocto: stake.toString(),
    stakeNear: nearOf(stake),
    gas: gas.toString(),
    prepaidYocto: prepaid.toString(),
    prepaidNear: nearOf(prepaid),
    burnedYocto: burned.toString(),
    burnedNear: nearOf(burned),
    accountCreationYocto: ACCOUNT_CREATION_YOCTO.toString(),
    accountCreationNear: nearOf(ACCOUNT_CREATION_YOCTO),
    ownerBalanceYocto: balance.toString(),
    ownerBalanceNear: nearOf(balance),
    expectedReturnNear: BOARD_V2_RETURN_NEAR,
    ownerAfterReturnYocto: afterReturn.toString(),
    ownerAfterReturnNear: nearOf(afterReturn),
    peakYocto: peak.toString(),
    peakNear: nearOf(peak),
    coveredNow: balance >= peak,
    coveredAfterReturn: afterReturn >= peak,
    shopExists: !!input.shopExists,
    transfer,
    transfers: [transfer],
    steps,
    liveReady: !input.shopExists && balance >= peak && !!input.wasmSha256,
  };
}

export function printPlan(plan) {
  console.log('Successor: ' + plan.shop);
  console.log('Legacy shop (not touched): ' + plan.legacy);
  console.log('Owner: ' + plan.owner);
  console.log('Wasm bytes: ' + plan.wasmBytes);
  console.log('Wasm sha256: ' + plan.wasmSha256);
  console.log('Storage bytes: ' + plan.storageBytes + ' (100 byte account + wasm + ' + plan.stateSlackBytes + ' byte state slack)');
  console.log('Storage stake: ' + plan.stakeYocto + ' yoctoNEAR (' + plan.stakeNear + ' NEAR)');
  console.log('Transfer: ' + plan.transfer.amountYocto + ' yoctoNEAR (' + plan.stakeNear + ' NEAR) from ' + plan.transfer.from + ' to ' + plan.transfer.payee);
  console.log('Prepaid gas: ' + plan.prepaidYocto + ' yoctoNEAR (' + plan.prepaidNear + ' NEAR), of which ' + plan.burnedNear + ' NEAR is burned');
  console.log('Account creation burn: ' + plan.accountCreationYocto + ' yoctoNEAR (' + plan.accountCreationNear + ' NEAR), taken from the gas refund');
  console.log('Peak the owner must hold: ' + plan.peakYocto + ' yoctoNEAR (' + plan.peakNear + ' NEAR)');
  console.log('Owner balance now: ' + plan.ownerBalanceYocto + ' yoctoNEAR (' + plan.ownerBalanceNear + ' NEAR). Covers the peak: ' + (plan.coveredNow ? 'yes' : 'no'));
  console.log('Expected board v2 return: about ' + plan.expectedReturnNear + ' NEAR to ' + plan.owner + '. Balance after that return: ' + plan.ownerAfterReturnNear + ' NEAR. Covers the peak: ' + (plan.coveredAfterReturn ? 'yes' : 'no'));
  console.log('Steps:');
  for (const step of plan.steps) console.log('  ' + (step.ok ? 'ok' : 'blocked') + '  ' + step.step + ' — ' + step.pre);
  console.log('The legacy shop is not a source and is not a payee. Its NEAR is a separate recovery.');
}

function optimize(wasm) {
  const src = join(tmpdir(), 'house_nft.in.wasm');
  const out = join(tmpdir(), 'house_nft.opt.wasm');
  writeFileSync(src, wasm);
  const ran = spawnSync('wasm-opt', ['-Oz', src, '-o', out], { stdio: 'inherit' });
  if (ran.status !== 0) return wasm;
  return readFileSync(out);
}

function buildWasm(root) {
  const path = join(root, WASM_REL);
  const built = spawnSync('cargo', ['+1.86.0', 'build', '--manifest-path', 'contracts/house_nft/Cargo.toml', '--target', 'wasm32-unknown-unknown', '--release', '--locked'], {
    cwd: root, stdio: 'inherit',
  });
  if (built.status !== 0 || !existsSync(path)) throw new Error('house wasm did not build');
  return optimize(readFileSync(path));
}

async function rpc(method, params) {
  const res = await fetch(MAIN.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) {
    const text = JSON.stringify(body.error);
    const err = new Error(body.error.data || body.error.message || 'rpc');
    err.missing = /UNKNOWN_ACCOUNT|does not exist/i.test(text);
    throw err;
  }
  return body.result;
}

async function accountOf(id) {
  try {
    const account = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: id });
    return { exists: true, amount: account.amount };
  } catch (err) {
    if (err.missing) return { exists: false, amount: '0' };
    throw err;
  }
}

async function main() {
  const live = process.argv.includes('--live');
  if (HOUSE_SHOP === HOUSE_LEGACY || HOUSE_OWNER !== MAIN.root) {
    console.error('extras.house.shop must be a new subaccount of ' + MAIN.root);
    process.exit(1);
  }
  const root = new URL('..', import.meta.url).pathname;
  const wasm = buildWasm(root);
  const sha = createHash('sha256').update(wasm).digest('hex');
  const owner = await accountOf(HOUSE_OWNER);
  const shop = await accountOf(HOUSE_SHOP);
  if (!owner.exists) throw new Error(HOUSE_OWNER + ' was not readable');
  const plan = planSuccessor({
    shop: HOUSE_SHOP,
    owner: HOUSE_OWNER,
    legacy: HOUSE_LEGACY,
    wasmBytes: wasm.length,
    wasmSha256: sha,
    ownerBalanceYocto: owner.amount,
    shopExists: shop.exists,
  });
  printPlan(plan);
  const keySet = !!process.env.NEAR_MAINNET_SIGNER_KEY;
  console.log('Signer key: ' + (keySet ? 'set' : 'not set') + ' (the value is not printed)');
  if (!live) {
    console.log('Dry-run. This command does not sign and does not send NEAR.');
    console.log('Live command: NEAR_MAINNET_SIGNER_KEY=\'ed25519:...\' node scripts/house-deploy.js --live');
    process.exit(0);
  }
  const key = process.env.NEAR_MAINNET_SIGNER_KEY || '';
  if (!key.startsWith('ed25519:')) {
    console.error('Refusing to sign: set NEAR_MAINNET_SIGNER_KEY to the ed25519 secret of ' + HOUSE_OWNER + '.');
    process.exit(2);
  }
  if (plan.shopExists) {
    console.error('Refusing to sign: ' + HOUSE_SHOP + ' already exists.');
    process.exit(2);
  }
  if (!plan.coveredNow) {
    console.error('Refusing to sign: ' + HOUSE_OWNER + ' holds ' + plan.ownerBalanceNear + ' NEAR and the peak is ' + plan.peakNear + ' NEAR.');
    process.exit(2);
  }
  const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
  const signer = new Account(HOUSE_OWNER, new JsonRpcProvider({ url: MAIN.rpc }), KeyPairSigner.fromSecretKey(key));
  const pub = signer.signer.getPublicKey().toString();
  let keyOnAccount = false;
  try {
    await signer.provider.query({ request_type: 'view_access_key', finality: 'final', account_id: HOUSE_OWNER, public_key: pub });
    keyOnAccount = true;
  } catch { keyOnAccount = false; }
  if (!keyOnAccount) {
    console.error('Refusing to sign: that key is not an access key of ' + HOUSE_OWNER + '.');
    process.exit(2);
  }
  const TG = 10n ** 12n;
  const sent = await signer.signAndSendTransaction({
    receiverId: HOUSE_SHOP,
    waitUntil: 'FINAL',
    throwOnFailure: false,
    actions: [
      A.createAccount(),
      A.transfer(BigInt(plan.stakeYocto)),
      A.deployContract(new Uint8Array(wasm)),
      A.functionCall('new', { owner: HOUSE_OWNER }, 80n * TG, 0n),
    ],
  });
  const bad = sent.status?.Failure || sent.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
  console.log((bad ? 'FAILED' : 'OK') + (sent.transaction?.hash ? ' ' + sent.transaction.hash : ''));
  if (bad) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch(err => {
  const msg = String(err?.message || 'house deploy failed');
  console.error(/ed25519:/.test(msg) ? 'house deploy failed' : msg);
  process.exit(1);
});
