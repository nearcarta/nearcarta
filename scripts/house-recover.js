#!/usr/bin/env node
// What the legacy shop can still do with its NEAR. Dry-run by default.
// --live signs the next step only, with NEAR_MAINNET_SIGNER_KEY, and is never run from here.
// The shop account has no key. The signer is the owner, who is also the deed holder.
//
//   node scripts/house-recover.js
//   NEAR_MAINNET_SIGNER_KEY='ed25519:...' node scripts/house-recover.js --live

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HOUSE_LEGACY, HOUSE_OWNER } from '../shared/house/shop.js';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };

const NOTES = {
  house_pay: 'Deed holder. Deposit 1 yocto. Sends up to the purse cap from that purse to the named receiver. The predecessor is the holder, so the shop needs no key.',
  house_fund: 'Anyone may attach NEAR. This adds to the purse. It does not recover it.',
  house_lower_cap: 'The holder may lower the cap. It does not move NEAR.',
  close: 'Owner only. Deposit 1 yocto. Refuses while house_held is above 0. Then delete_account pays the remaining balance, including the storage stake, to the owner. The shop needs no key. This is the self-delete.',
  upgrade: 'Would replace the wasm. Offered only when the wasm exports it.',
  migrate: 'Would rewrite state. Offered only when the wasm exports it.',
  house_withdraw: 'Would pay the purse to the current holder. Offered only when the wasm exports it.',
};

function readLeb(buf, at) {
  let result = 0n;
  let shift = 0n;
  let i = at;
  while (i < buf.length) {
    const b = buf[i++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: result, at: i };
    shift += 7n;
    if (shift > 63n) throw new Error('leb');
  }
  throw new Error('leb');
}

/** Function names from a wasm export section. */
export function wasmExports(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 8 || buf[0] !== 0 || buf.toString('utf8', 1, 4) !== 'asm') throw new Error('not wasm');
  let at = 8;
  const names = [];
  while (at < buf.length) {
    const id = buf[at++];
    const size = readLeb(buf, at);
    at = size.at;
    const end = at + Number(size.value);
    if (end > buf.length) throw new Error('wasm section');
    if (id === 7) {
      const count = readLeb(buf, at);
      let cursor = count.at;
      for (let n = 0; n < Number(count.value); n++) {
        const len = readLeb(buf, cursor);
        cursor = len.at;
        const name = buf.toString('utf8', cursor, cursor + Number(len.value));
        cursor += Number(len.value);
        const kind = buf[cursor++];
        const index = readLeb(buf, cursor);
        cursor = index.at;
        if (kind === 0 && /^[A-Za-z]/.test(name)) names.push(name);
      }
    }
    at = end;
  }
  return names;
}

/** `pub fn` names in a Rust source file. */
export function sourceMethods(text) {
  return [...String(text).matchAll(/\bpub\s+fn\s+([A-Za-z0-9_]+)/g)].map(m => m[1]);
}

/**
 * Recovery steps that the wasm actually exports.
 * A missing upgrade, migrate, or withdraw is not invented.
 * @param {{ exports: string[], purseYocto: string, heldYocto: string, holder: string, owner: string, shop: string }} input
 */
export function recoveryPlan(input) {
  const exported = new Set(input.exports || []);
  const purse = BigInt(input.purseYocto || 0);
  const held = BigInt(input.heldYocto || 0);
  const holder = input.holder;
  const owner = input.owner;
  const shop = input.shop;
  const steps = [];
  if (exported.has('house_pay') && purse > 0n) {
    steps.push({
      method: 'house_pay',
      signer: holder,
      receiver: shop,
      depositYocto: '1',
      args: { token_id: holder, receiver_id: holder, amount: purse.toString() },
      recoversYocto: purse.toString(),
      note: NOTES.house_pay,
    });
  }
  if (exported.has('close')) {
    steps.push({
      method: 'close',
      signer: owner,
      receiver: shop,
      depositYocto: '1',
      args: {},
      pre: held > 0n || purse > 0n
        ? 'Run this only after house_held is 0. The house_pay callback has to finish first. This command signs one step at a time.'
        : 'house_held is 0, so close can run.',
      recovers: 'the remaining account balance, including storage, by delete_account to ' + owner,
      note: NOTES.close,
    });
  }
  const absent = ['house_withdraw', 'upgrade', 'migrate', 'migrate_from_v2'].filter(name => !exported.has(name));
  return {
    shop,
    owner,
    holder,
    locked: steps.length === 0,
    steps,
    absent,
    why: steps.length
      ? 'The open purse leaves by house_pay to the deed holder. The storage leaves by close, which is the self-delete. Neither needs a key on the shop. There is no owner withdraw besides close, and no migrate or upgrade on this wasm.'
      : 'No owner withdraw, deed-holder spend, migrate, upgrade, or self-delete is exported. That NEAR stays on the shop. This script does not touch it.',
  };
}

function legacySource() {
  try {
    return execFileSync('git', ['show', 'origin/main:contracts/house_nft/src/lib.rs'], { encoding: 'utf8', maxBuffer: 1 << 22 });
  } catch {
    return '';
  }
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

export function printRecovery({ plan, exports, source, sha256, recordedSha }) {
  console.log('Legacy shop: ' + plan.shop);
  console.log('Wasm sha256: ' + sha256);
  console.log('Recorded sha256: ' + (recordedSha || 'none') + (recordedSha && recordedSha === sha256 ? ' (matches)' : ''));
  console.log('Public methods on the chain wasm: ' + exports.join(', '));
  console.log('Public methods in the origin/main source: ' + (source.length ? source.join(', ') : 'unreadable'));
  const onlyChain = exports.filter(name => source.length && !source.includes(name));
  const onlySource = source.filter(name => !exports.includes(name));
  const trait = onlyChain.filter(name => name.startsWith('nft_') || name === 'contract_source_metadata');
  const other = onlyChain.filter(name => !trait.includes(name));
  if (trait.length) console.log('Trait exports, not written as pub fn in that source: ' + trait.join(', '));
  if (other.length) console.log('Exported on chain and not in that source: ' + other.join(', '));
  if (onlySource.length) console.log('In that source and not exported on chain: ' + onlySource.join(', '));
  console.log(plan.why);
  console.log('Not on this wasm: ' + (plan.absent.length ? plan.absent.join(', ') : 'none of the checked names'));
  if (!plan.steps.length) {
    console.log('Locked. This script does not send a transaction.');
    return;
  }
  plan.steps.forEach((step, i) => {
    console.log('Step ' + (i + 1) + ': ' + step.signer + ' calls ' + step.method + ' on ' + step.receiver + ' with ' + step.depositYocto + ' yoctoNEAR');
    console.log('  args: ' + JSON.stringify(step.args));
    if (step.recoversYocto) console.log('  recovers: ' + step.recoversYocto + ' yoctoNEAR');
    if (step.recovers) console.log('  recovers: ' + step.recovers);
    if (step.pre) console.log('  ' + step.pre);
    console.log('  ' + step.note);
  });
}

async function main() {
  const live = process.argv.includes('--live');
  const code = await rpc('query', { request_type: 'view_code', finality: 'final', account_id: HOUSE_LEGACY });
  const wasm = Buffer.from(code.code_base64, 'base64');
  const sha256 = createHash('sha256').update(wasm).digest('hex');
  const exports = wasmExports(wasm);
  const source = sourceMethods(legacySource());
  const tokens = await viewCall(HOUSE_LEGACY, 'nft_tokens', { from_index: '0', limit: 50 });
  let purse = 0n;
  let holder = HOUSE_OWNER;
  for (const token of tokens) {
    const row = await viewCall(HOUSE_LEGACY, 'house_purse', { token_id: token.token_id });
    const balance = BigInt(row?.balance || 0);
    if (balance > purse) {
      purse = balance;
      holder = token.owner_id;
    }
  }
  const heldRaw = await viewCall(HOUSE_LEGACY, 'house_held', {});
  const held = BigInt(typeof heldRaw === 'string' ? heldRaw : (heldRaw?.amount ?? heldRaw ?? 0));
  const plan = recoveryPlan({
    exports, purseYocto: purse.toString(), heldYocto: held.toString(), holder, owner: HOUSE_OWNER, shop: HOUSE_LEGACY,
  });
  printRecovery({ plan, exports, source, sha256, recordedSha: MAIN.extras?.house?.sha256 });
  const keySet = !!process.env.NEAR_MAINNET_SIGNER_KEY;
  console.log('Signer key: ' + (keySet ? 'set' : 'not set') + ' (the value is not printed)');
  if (!live) {
    console.log('Dry-run. This command does not sign and does not send NEAR.');
    console.log('Live command, one step at a time: NEAR_MAINNET_SIGNER_KEY=\'ed25519:...\' node scripts/house-recover.js --live');
    process.exit(0);
  }
  if (plan.locked) {
    console.error('Refusing to sign: nothing on this wasm recovers the NEAR.');
    process.exit(2);
  }
  const key = process.env.NEAR_MAINNET_SIGNER_KEY || '';
  if (!key.startsWith('ed25519:')) {
    console.error('Refusing to sign: set NEAR_MAINNET_SIGNER_KEY to the ed25519 secret of ' + HOUSE_OWNER + '.');
    process.exit(2);
  }
  const step = plan.steps[0];
  if (step.method === 'close' && (purse > 0n || held > 0n)) {
    console.error('Refusing to sign close while house_held is above 0.');
    process.exit(2);
  }
  const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
  const signer = new Account(step.signer, new JsonRpcProvider({ url: MAIN.rpc }), KeyPairSigner.fromSecretKey(key));
  const TG = 10n ** 12n;
  const sent = await signer.signAndSendTransaction({
    receiverId: step.receiver,
    waitUntil: 'FINAL',
    throwOnFailure: false,
    actions: [A.functionCall(step.method, step.args, 80n * TG, 1n)],
  });
  const bad = sent.status?.Failure || sent.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
  console.log((bad ? 'FAILED' : 'OK') + (sent.transaction?.hash ? ' ' + sent.transaction.hash : ''));
  if (bad) process.exit(1);
  if (plan.steps.length > 1) console.log('One step was signed. Run the dry-run again before the next step.');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch(err => {
  const msg = String(err?.message || 'house recover failed');
  console.error(/ed25519:/.test(msg) ? 'house recover failed' : msg);
  process.exit(1);
});
