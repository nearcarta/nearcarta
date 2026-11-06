#!/usr/bin/env node
// Recreate the house shop after house-recover.js returns its balance.
// Dry-run by default. --live signs only once that account is gone.
// The signer key is read from NEAR_MAINNET_SIGNER_KEY and is never printed.
// The wasm is the committed size-optimized file, not a fresh cargo build.
//
//   node scripts/house-recover.js
//   node scripts/house-deploy.js
//   NEAR_MAINNET_SIGNER_KEY='ed25519:...' node scripts/house-recover.js --live
//   NEAR_MAINNET_SIGNER_KEY='ed25519:...' node scripts/house-deploy.js --live

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  ACCOUNT_BYTES, ACCOUNT_CREATION_YOCTO, BYTE_YOCTO, GAS_PRICE_YOCTO, GAS_PURCHASE_YOCTO, deployGas,
} from '../shared/board/cost.js';
import { HOUSE_FALLBACK, HOUSE_LEGACY, HOUSE_OWNER, HOUSE_SHOP, HOUSE_WASM_PATH, HOUSE_WASM_SHA256 } from '../shared/house/shop.js';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };

export const HOUSE_STATE_SLACK = 2048n;
export const MAX_STAKE_NEAR = '3.8';
export const MAX_STAKE_YOCTO = 3_800_000_000_000_000_000_000_000n;

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
 * Stake for recreating the shop after close. The funding source is the legacy balance.
 * The state slack covers the empty NFT metadata and map prefixes.
 * @param {{
 *   shop: string, owner: string, legacy: string, fallback?: string,
 *   wasmBytes: number, wasmSha256: string, pinnedSha256: string,
 *   ownerBalanceYocto: string, legacyBalanceYocto: string, shopExists: boolean, argBytes?: number,
 * }} input
 */
export function planSuccessor(input) {
  const shop = input.shop;
  const owner = input.owner;
  const legacy = input.legacy;
  if (!shop || !owner || !legacy) throw new Error('shop, owner and legacy are required');
  const wasmBytes = BigInt(input.wasmBytes);
  if (wasmBytes <= 0n) throw new Error('wasm length');
  const args = JSON.stringify({ owner });
  const argBytes = BigInt(input.argBytes ?? args.length);
  const storage = ACCOUNT_BYTES + wasmBytes + HOUSE_STATE_SLACK;
  const stake = storage * BYTE_YOCTO;
  const gas = deployGas(wasmBytes, argBytes);
  const prepaid = gas * GAS_PURCHASE_YOCTO;
  const burned = gas * GAS_PRICE_YOCTO;
  const ownerBalance = BigInt(input.ownerBalanceYocto || 0);
  const legacyBalance = BigInt(input.legacyBalanceYocto || 0);
  const peak = stake + prepaid;
  const afterRecovery = ownerBalance + legacyBalance;
  const hashOk = input.wasmSha256 === input.pinnedSha256 && !!input.pinnedSha256;
  const stakeOk = stake <= MAX_STAKE_YOCTO;
  const recovered = !input.shopExists;
  const coveredAfterRecovery = afterRecovery >= peak;
  const transfer = {
    kind: 'fund',
    from: owner,
    payee: shop,
    amountYocto: stake.toString(),
    source: legacy,
    sourceYocto: legacyBalance.toString(),
    why: 'recreate ' + shop + ' after close. The funding source is the legacy balance house_pay and close return to ' + owner,
  };
  if (transfer.payee !== shop || transfer.from !== owner) throw new Error('funding parties');
  if (input.fallback && transfer.payee === input.fallback) throw new Error('the fallback account is not the payee');
  const steps = [
    {
      step: 'recover first',
      pre: input.shopExists
        ? `run house-recover.js first. ${legacy} holds ${nearOf(legacyBalance)} NEAR, and that balance is the funding source`
        : `${legacy} is already gone. Its balance has returned to ${owner}`,
      ok: recovered,
    },
    {
      step: 'pinned wasm',
      pre: hashOk
        ? `sha256 ${input.wasmSha256} matches the pin`
        : `sha256 ${input.wasmSha256 || 'missing'} does not match the pin ${input.pinnedSha256 || 'missing'}`,
      ok: hashOk,
    },
    {
      step: 'stake under 3.8 NEAR',
      pre: stakeOk ? `stake ${nearOf(stake)} NEAR` : `stake ${nearOf(stake)} NEAR is over ${MAX_STAKE_NEAR} NEAR`,
      ok: stakeOk,
    },
    {
      step: 'recovered balance covers the peak',
      pre: `${owner} holds ${nearOf(ownerBalance)} NEAR now. After close it holds ${nearOf(afterRecovery)} NEAR. Peak is ${nearOf(peak)} NEAR`,
      ok: coveredAfterRecovery,
    },
    {
      step: 'create, transfer, deploy, new',
      pre: `one transaction from ${owner} recreates ${shop}. wasm ${wasmBytes} bytes`,
      ok: hashOk && stakeOk && recovered && ownerBalance >= peak,
    },
  ];
  return {
    shop,
    owner,
    legacy,
    fallback: input.fallback || '',
    wasmBytes: Number(wasmBytes),
    wasmSha256: input.wasmSha256,
    pinnedSha256: input.pinnedSha256,
    hashOk,
    stakeOk,
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
    ownerBalanceYocto: ownerBalance.toString(),
    ownerBalanceNear: nearOf(ownerBalance),
    legacyBalanceYocto: legacyBalance.toString(),
    legacyBalanceNear: nearOf(legacyBalance),
    fundingSource: legacy,
    fundingSourceYocto: legacyBalance.toString(),
    afterRecoveryYocto: afterRecovery.toString(),
    afterRecoveryNear: nearOf(afterRecovery),
    peakYocto: peak.toString(),
    peakNear: nearOf(peak),
    coveredAfterRecovery,
    shopExists: !!input.shopExists,
    transfer,
    transfers: [transfer],
    steps,
    liveReady: hashOk && stakeOk && recovered && ownerBalance >= peak,
  };
}

export function printPlan(plan) {
  console.log('Shop: ' + plan.shop);
  console.log('Fallback (not used): ' + (plan.fallback || 'none'));
  console.log('Owner: ' + plan.owner);
  console.log('Wasm bytes: ' + plan.wasmBytes);
  console.log('Wasm sha256: ' + plan.wasmSha256);
  console.log('Pinned sha256: ' + plan.pinnedSha256 + (plan.hashOk ? ' (matches)' : ' (does not match)'));
  console.log('Storage bytes: ' + plan.storageBytes + ' (100 byte account + wasm + ' + plan.stateSlackBytes + ' byte state slack)');
  console.log('Storage stake: ' + plan.stakeYocto + ' yoctoNEAR (' + plan.stakeNear + ' NEAR)');
  console.log('Funding source: ' + plan.fundingSource + ' balance ' + plan.fundingSourceYocto + ' yoctoNEAR (' + plan.legacyBalanceNear + ' NEAR), returned by house_pay then close');
  console.log('Transfer: ' + plan.transfer.amountYocto + ' yoctoNEAR (' + plan.stakeNear + ' NEAR) from ' + plan.transfer.from + ' to ' + plan.transfer.payee);
  console.log('Prepaid gas: ' + plan.prepaidYocto + ' yoctoNEAR (' + plan.prepaidNear + ' NEAR), of which ' + plan.burnedNear + ' NEAR is burned');
  console.log('Account creation burn: ' + plan.accountCreationYocto + ' yoctoNEAR (' + plan.accountCreationNear + ' NEAR), taken from the gas refund');
  console.log('Peak: ' + plan.peakYocto + ' yoctoNEAR (' + plan.peakNear + ' NEAR)');
  console.log('Owner balance now: ' + plan.ownerBalanceYocto + ' yoctoNEAR (' + plan.ownerBalanceNear + ' NEAR)');
  console.log('Owner balance after recovery: ' + plan.afterRecoveryYocto + ' yoctoNEAR (' + plan.afterRecoveryNear + ' NEAR). Covers the peak: ' + (plan.coveredAfterRecovery ? 'yes' : 'no'));
  console.log('Steps:');
  for (const step of plan.steps) console.log('  ' + (step.ok ? 'ok' : 'blocked') + '  ' + step.step + ' — ' + step.pre);
  console.log('Recover with node scripts/house-recover.js before this create.');
}

function pinnedWasm() {
  const wasm = readFileSync(new URL('../' + HOUSE_WASM_PATH, import.meta.url));
  const sha = createHash('sha256').update(wasm).digest('hex');
  return { wasm, sha };
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
  if (HOUSE_SHOP !== HOUSE_LEGACY || HOUSE_OWNER !== MAIN.root) {
    console.error('extras.house.shop must be the shop account ' + HOUSE_LEGACY);
    process.exit(1);
  }
  if (!HOUSE_WASM_PATH || !HOUSE_WASM_SHA256) {
    console.error('extras.house.next wasm and sha256 are required');
    process.exit(1);
  }
  const { wasm, sha } = pinnedWasm();
  const owner = await accountOf(HOUSE_OWNER);
  const shop = await accountOf(HOUSE_SHOP);
  if (!owner.exists) throw new Error(HOUSE_OWNER + ' was not readable');
  const plan = planSuccessor({
    shop: HOUSE_SHOP,
    owner: HOUSE_OWNER,
    legacy: HOUSE_LEGACY,
    fallback: HOUSE_FALLBACK,
    wasmBytes: wasm.length,
    wasmSha256: sha,
    pinnedSha256: HOUSE_WASM_SHA256,
    ownerBalanceYocto: owner.amount,
    legacyBalanceYocto: shop.exists ? shop.amount : '0',
    shopExists: shop.exists,
  });
  printPlan(plan);
  const keySet = !!process.env.NEAR_MAINNET_SIGNER_KEY;
  console.log('Signer key: ' + (keySet ? 'set' : 'not set') + ' (the value is not printed)');
  if (!plan.hashOk || !plan.stakeOk) {
    console.error('Dry-run failed: the wasm hash must match the pin and the stake must be at most ' + MAX_STAKE_NEAR + ' NEAR.');
    process.exit(1);
  }
  if (!live) {
    console.log('Dry-run. This command does not sign and does not send NEAR.');
    console.log('Live command, after house-recover.js --live: NEAR_MAINNET_SIGNER_KEY=\'ed25519:...\' node scripts/house-deploy.js --live');
    process.exit(0);
  }
  const key = process.env.NEAR_MAINNET_SIGNER_KEY || '';
  if (!key.startsWith('ed25519:')) {
    console.error('Refusing to sign: set NEAR_MAINNET_SIGNER_KEY to the ed25519 secret of ' + HOUSE_OWNER + '.');
    process.exit(2);
  }
  if (plan.shopExists) {
    console.error('Refusing to sign: run node scripts/house-recover.js --live first. ' + HOUSE_SHOP + ' still holds ' + plan.legacyBalanceNear + ' NEAR.');
    process.exit(2);
  }
  if (!plan.liveReady) {
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
