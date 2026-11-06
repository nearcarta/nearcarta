#!/usr/bin/env node
// Redeploy the house contract onto the existing shop account.
// Dry-run by default. --live signs. The signer key is read from HOUSE_SIGNER_KEY
// and is never printed.
//
//   node scripts/house-deploy.js
//   HOUSE_SIGNER_KEY='ed25519:...' node scripts/house-deploy.js --live
//
// Purse balances go back to the current deed holders before the new state is written.
// A funding transfer, when one is needed, goes from the owner to the shop account.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };

export const BYTE_YOCTO = 10n ** 19n;
export const STATE_GROWTH_BYTES = 1024n;
const GAS_PRICE = 100_000_000n;
const GAS_PURCHASE = 1_000_000_000n;
const WASM_REL = 'contracts/house_nft/target/wasm32-unknown-unknown/release/house_nft.wasm';

const DEPLOY_SEND = 184_765_750_000n;
const DEPLOY_SEND_PER_BYTE = 47_683_715n;
const DEPLOY_EXEC = 184_765_750_000n;
const DEPLOY_EXEC_PER_BYTE = 64_572_944n;
const CALL_SEND = 200_000_000_000n;
const CALL_SEND_PER_BYTE = 47_683_715n;
const CALL_EXEC = 780_000_000_000n;
const CALL_EXEC_PER_BYTE = 2_235_934n;

export function deployGas(wasmLen, argBytes = 2n) {
  const n = BigInt(wasmLen);
  const a = BigInt(argBytes);
  return DEPLOY_SEND + DEPLOY_SEND_PER_BYTE * n + DEPLOY_EXEC + DEPLOY_EXEC_PER_BYTE * n
    + CALL_SEND + CALL_SEND_PER_BYTE * a + CALL_EXEC + CALL_EXEC_PER_BYTE * a;
}

export function nearOf(yocto) {
  const v = BigInt(yocto);
  const whole = v / 10n ** 24n;
  const frac = (v % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/**
 * @param {{
 *   shop: string, owner: string, wasmBytes: number, wasmSha256: string,
 *   oldCodeBytes: number, storageUsage: number, balanceYocto: string,
 *   fullAccessKeys: number, codeHash: string, recordedHash: string,
 *   purses: { tokenId: string, owner: string, balanceYocto: string }[],
 * }} input
 */
export function planDeploy(input) {
  const shop = input.shop;
  const owner = input.owner;
  if (!shop || !owner) throw new Error('shop and owner are required');
  const wasmBytes = BigInt(input.wasmBytes);
  const oldCode = BigInt(input.oldCodeBytes);
  const usage = BigInt(input.storageUsage) - oldCode + wasmBytes + STATE_GROWTH_BYTES;
  if (usage <= 0n) throw new Error('storage usage');
  const stake = usage * BYTE_YOCTO;
  const gas = deployGas(wasmBytes);
  const prepaid = gas * GAS_PURCHASE;
  const burned = gas * GAS_PRICE;
  const balance = BigInt(input.balanceYocto);
  const refunds = [];
  for (const p of input.purses || []) {
    const amount = BigInt(p.balanceYocto || 0);
    if (amount <= 0n) continue;
    if (!p.owner) throw new Error('a purse needs its holder');
    refunds.push({
      kind: 'refund',
      payee: p.owner,
      tokenId: p.tokenId,
      amountYocto: amount.toString(),
      why: 'open purse, returned to the current deed holder',
    });
  }
  const refundSum = refunds.reduce((sum, row) => sum + BigInt(row.amountYocto), 0n);
  // Prepaid gas is locked before the unused part comes back, so the shop must hold it
  // on top of the new stake. The burn is what does not return.
  const endNeed = stake + prepaid + refundSum;
  const peakNeed = prepaid + refundSum;
  const need = endNeed > peakNeed ? endNeed : peakNeed;
  const shortfall = balance >= need ? 0n : need - balance;
  const transfers = [];
  if (shortfall > 0n) {
    transfers.push({
      kind: 'fund',
      from: owner,
      payee: shop,
      amountYocto: shortfall.toString(),
      why: 'the shop balance does not cover the new storage stake and the prepaid gas',
    });
  }
  for (const row of transfers) {
    if (row.payee !== shop && row.payee !== owner) throw new Error('funding payee');
    if (row.from !== shop && row.from !== owner) throw new Error('funding source');
  }
  const balanceAfter = balance + shortfall - refundSum - burned;
  const steps = [
    {
      step: 'read the account',
      pre: `account ${shop} exists, code hash ${input.codeHash || 'unread'}`,
      ok: true,
    },
    {
      step: 'refund open purses',
      pre: refunds.length ? `${refunds.length} purse(s) with a balance` : 'no open purse',
      ok: true,
    },
    {
      step: 'fund the shortfall',
      pre: shortfall === 0n ? 'the balance covers the stake and the gas' : `${owner} must transfer ${nearOf(shortfall)} NEAR to ${shop} first`,
      ok: true,
    },
    {
      step: 'full-access key',
      pre: input.fullAccessKeys > 0 ? `${input.fullAccessKeys} full-access key(s) on ${shop}` : `no access key on ${shop}; --live refuses until one exists`,
      ok: input.fullAccessKeys > 0,
    },
    {
      step: 'deploy and migrate_from_v2',
      pre: `wasm ${wasmBytes} bytes, sha256 ${input.wasmSha256}, recorded code ${input.recordedHash || 'none'}`,
      ok: wasmBytes > 0n && !!input.wasmSha256,
    },
    {
      step: 'post-deploy view',
      pre: 'house_version, house_held, nft_total_supply',
      ok: true,
    },
    {
      step: 'smoke',
      pre: 'not sent. Any visitor: propose_call_as to house_session_check_in. Deposit is that row\'s min_amount, or 1 yocto when the minimum is 0. Args are {"token_id":"<the visitor\'s deed>"}. hold is false. The board writes row_owner.',
      ok: true,
    },
  ];
  return {
    shop,
    owner,
    wasmBytes: Number(wasmBytes),
    wasmSha256: input.wasmSha256,
    storageBytes: usage.toString(),
    stakeYocto: stake.toString(),
    stakeNear: nearOf(stake),
    gas: gas.toString(),
    prepaidYocto: prepaid.toString(),
    prepaidNear: nearOf(prepaid),
    burnedYocto: burned.toString(),
    burnedNear: nearOf(burned),
    balanceBeforeYocto: balance.toString(),
    balanceBeforeNear: nearOf(balance),
    balanceAfterYocto: balanceAfter.toString(),
    balanceAfterNear: nearOf(balanceAfter),
    shortfallYocto: shortfall.toString(),
    shortfallNear: nearOf(shortfall),
    refunds,
    transfers,
    steps,
    stateGrowthBytes: STATE_GROWTH_BYTES.toString(),
    liveReady: input.fullAccessKeys > 0 && wasmBytes > 0n,
  };
}

function printPlan(plan) {
  console.log('Shop: ' + plan.shop);
  console.log('Owner: ' + plan.owner);
  console.log('Wasm bytes: ' + plan.wasmBytes);
  console.log('Wasm sha256: ' + plan.wasmSha256);
  console.log('Storage bytes (estimate, includes ' + plan.stateGrowthBytes + ' bytes of new state): ' + plan.storageBytes);
  console.log('Storage stake: ' + plan.stakeYocto + ' yoctoNEAR (' + plan.stakeNear + ' NEAR)');
  console.log('Balance before: ' + plan.balanceBeforeYocto + ' yoctoNEAR (' + plan.balanceBeforeNear + ' NEAR)');
  console.log('Balance after: ' + plan.balanceAfterYocto + ' yoctoNEAR (' + plan.balanceAfterNear + ' NEAR)');
  console.log('Prepaid gas: ' + plan.prepaidYocto + ' yoctoNEAR (' + plan.prepaidNear + ' NEAR), of which ' + plan.burnedNear + ' NEAR is burned');
  console.log('Refunds (to the current deed holder):');
  if (!plan.refunds.length) console.log('  none');
  for (const row of plan.refunds) {
    console.log('  ' + row.amountYocto + ' yoctoNEAR (' + nearOf(row.amountYocto) + ' NEAR) to ' + row.payee + ' (' + row.why + ', deed ' + row.tokenId + ')');
  }
  console.log('Transfers (owner or shop only):');
  if (!plan.transfers.length) console.log('  none');
  for (const row of plan.transfers) {
    console.log('  ' + row.amountYocto + ' yoctoNEAR (' + nearOf(row.amountYocto) + ' NEAR) from ' + row.from + ' to ' + row.payee + ' (' + row.why + ')');
  }
  console.log('Steps:');
  for (const step of plan.steps) {
    console.log('  ' + (step.ok ? 'ok' : 'blocked') + '  ' + step.step + ' — ' + step.pre);
  }
  console.log('Post-deploy view: house_version, house_held, nft_total_supply on ' + plan.shop);
  console.log('Smoke (not sent): any visitor whose row allows ' + plan.shop + ' calls propose_call_as.');
  console.log('  method house_session_check_in, hold false, deposit = that row\'s min_amount (1 yocto when the minimum is 0)');
  console.log('  args {"token_id":"<the visitor\'s deed>"} — the board writes the top-level row_owner');
  console.log('  a foreign prepare uses hold true, then confirm_hold; cancel_hold drops an unsent hold; expire_sent marks a sent hold after expiry and does not refund');
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
  if (body.error) throw new Error(body.error.message || 'rpc');
  return body.result;
}

async function viewCall(account, method, args) {
  const result = await rpc('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(result.result).toString());
}

async function readChain(shop) {
  const account = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: shop });
  const keys = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: shop });
  const code = await rpc('query', { request_type: 'view_code', finality: 'final', account_id: shop });
  const old = Buffer.from(code.code_base64, 'base64');
  const tokens = await viewCall(shop, 'nft_tokens', { from_index: '0', limit: 50 });
  const purses = [];
  for (const token of tokens) {
    const purse = await viewCall(shop, 'house_purse', { token_id: token.token_id });
    purses.push({
      tokenId: token.token_id,
      owner: token.owner_id,
      balanceYocto: purse?.balance || '0',
    });
  }
  return {
    balanceYocto: account.amount,
    storageUsage: account.storage_usage,
    codeHash: account.code_hash,
    fullAccessKeys: (keys.keys || []).length,
    oldCodeBytes: old.length,
    purses,
  };
}

async function main() {
  const live = process.argv.includes('--live');
  const house = MAIN.extras?.house;
  if (!house?.contract || house.owner !== MAIN.root) {
    console.error('mainnet.json extras.house.contract and owner are required');
    process.exit(1);
  }
  const root = new URL('..', import.meta.url).pathname;
  const wasm = buildWasm(root);
  const sha = createHash('sha256').update(wasm).digest('hex');
  const chain = await readChain(house.contract);
  const plan = planDeploy({
    shop: house.contract,
    owner: house.owner,
    wasmBytes: wasm.length,
    wasmSha256: sha,
    oldCodeBytes: chain.oldCodeBytes,
    storageUsage: chain.storageUsage,
    balanceYocto: chain.balanceYocto,
    fullAccessKeys: chain.fullAccessKeys,
    codeHash: chain.codeHash,
    recordedHash: house.code_hash,
    purses: chain.purses,
  });
  printPlan(plan);
  const keySet = !!process.env.HOUSE_SIGNER_KEY;
  console.log('Signer key: ' + (keySet ? 'set' : 'not set') + ' (the value is not printed)');
  if (!live) {
    console.log('Dry-run. This command does not sign and does not send NEAR.');
    console.log('Live command: HOUSE_SIGNER_KEY=\'ed25519:...\' node scripts/house-deploy.js --live');
    process.exit(0);
  }
  const key = process.env.HOUSE_SIGNER_KEY || '';
  if (!key.startsWith('ed25519:')) {
    console.error('Refusing to sign: set HOUSE_SIGNER_KEY to the ed25519 secret of ' + house.contract + '.');
    process.exit(2);
  }
  if (!plan.liveReady) {
    console.error('Refusing to sign: ' + house.contract + ' has no access key.');
    process.exit(2);
  }
  if (plan.shortfallYocto !== '0') {
    console.error('Refusing to sign: transfer ' + plan.shortfallNear + ' NEAR from ' + house.owner + ' to ' + house.contract + ' first.');
    process.exit(2);
  }
  const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
  const signer = new Account(house.contract, new JsonRpcProvider({ url: MAIN.rpc }), KeyPairSigner.fromSecretKey(key));
  const pub = signer.signer.getPublicKey().toString();
  let keyOnAccount = false;
  try {
    await signer.provider.query({ request_type: 'view_access_key', finality: 'final', account_id: house.contract, public_key: pub });
    keyOnAccount = true;
  } catch { keyOnAccount = false; }
  if (!keyOnAccount) {
    console.error('Refusing to sign: that key is not a full-access key of ' + house.contract + '.');
    process.exit(2);
  }
  const TG = 10n ** 12n;
  const sent = await signer.signAndSendTransaction({
    receiverId: house.contract,
    waitUntil: 'FINAL',
    throwOnFailure: false,
    actions: [
      A.deployContract(new Uint8Array(wasm)),
      A.functionCall('migrate_from_v2', {}, 80n * TG, 0n),
    ],
  });
  console.log('Deploy status: ' + (sent.status?.SuccessValue != null || sent.final_execution_status === 'FINAL' ? 'submitted' : 'see the receipt'));
  const version = await viewCall(house.contract, 'house_version', {});
  const held = await viewCall(house.contract, 'house_held', {});
  console.log('house_version: ' + JSON.stringify(version));
  console.log('house_held: ' + JSON.stringify(held));
  console.log('Smoke was not sent. Use the visitor\'s own row.');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch(err => { console.error(err?.message || 'house deploy failed'); process.exit(1); });
