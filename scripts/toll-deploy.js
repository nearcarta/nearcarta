// Redeploy toll.nearcarta.near from its own balance.
// Dry-run by default. --live signs. The signer key is TOLL_SIGNER_KEY and is never printed.
//
//   node scripts/toll-deploy.js
//   TOLL_SIGNER_KEY='ed25519:...' node scripts/toll-deploy.js --live
//
// The live wasm has no upgrade method and no full-access key, so the first
// install is close, then the same account. close() sends the balance to
// nearcarta.near. The next transaction sends it back. Later installs call
// upgrade, then migrate. No visitor address, amount, or allow list is stored.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bs58 from 'bs58';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };

const live = process.argv.includes('--live');
const SHOP = MAIN.toll.contract;
const OWNER = MAIN.toll.owner;
const BOARD = MAIN.board.contract;
const RPC = MAIN.rpc;
const BYTE = 10n ** 19n;
const ONE = 10n ** 24n;
const GAS_CUSHION = ONE / 20n;
const RECORDED_CODE = MAIN.toll.code_hash;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function payee(id) {
  if (id !== OWNER && id !== SHOP) throw new Error('Refusing a transfer to ' + id);
  return id;
}

function yocto(n) {
  const v = BigInt(n);
  const whole = (v / ONE).toString();
  const frac = (v % ONE).toString().padStart(24, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

function optimize(file) {
  const out = join(tmpdir(), 'toll-deploy-opt.wasm');
  const run = spawnSync('wasm-opt', ['-Oz', '--strip-debug', '--strip-producers', '-o', out, file], { encoding: 'utf8' });
  if (run.status === 0 && existsSync(out)) return out;
  return file;
}

function findWasm() {
  const named = process.env.TOLL_WASM;
  const built = 'contracts/toll/target/wasm32-unknown-unknown/release/oath_lab.wasm';
  const artifact = 'contracts/artifacts/toll.v7.wasm';
  if (named && existsSync(named)) return optimize(named);
  if (existsSync(built) && existsSync(artifact) && statSync(built).mtimeMs > statSync(artifact).mtimeMs) return optimize(built);
  if (existsSync(artifact)) return artifact;
  if (existsSync(built)) return optimize(built);
  const builtCmd = spawnSync('cargo', ['+1.86.0', 'build', '--target', 'wasm32-unknown-unknown', '--release', '--offline'], {
    cwd: 'contracts/toll', encoding: 'utf8',
  });
  if (builtCmd.status === 0 && existsSync(built)) return optimize(built);
  return null;
}

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}

async function viewAccount(id) {
  return rpc('query', { request_type: 'view_account', finality: 'final', account_id: id });
}

async function viewCall(id, method, args) {
  const res = await rpc('query', {
    request_type: 'call_function', finality: 'final', account_id: id, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args || {})).toString('base64'),
  });
  const raw = Buffer.from(res.result).toString('utf8');
  return raw ? JSON.parse(raw) : null;
}

const wasmFile = findWasm();
const wasm = wasmFile ? readFileSync(wasmFile) : null;
const sha = wasm ? createHash('sha256').update(wasm).digest() : null;
const codeHash = sha ? bs58.encode(sha) : null;

let account = null;
let ownerAccount = null;
let policy = null;
let keys = [];
let viewError = '';
try {
  account = await viewAccount(SHOP);
  ownerAccount = await viewAccount(OWNER);
  policy = await viewCall(SHOP, 'policy', {}).catch(e => { viewError = e.message; return null; });
  const listed = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: SHOP });
  keys = listed.keys || [];
} catch (e) {
  viewError = viewError || e.message;
}

const balanceBefore = account ? BigInt(account.amount) : null;
const storageNow = account ? BigInt(account.storage_usage) * BYTE : null;
const fullAccess = keys.filter(k => k.access_key?.permission === 'FullAccess').length;
const serviceHeld = policy && policy.service_held != null ? BigInt(policy.service_held) : 0n;
const openOrders = policy && policy.service_held != null ? 'service_held is the NEAR liability' : 'this wasm has no visitor service deposit';
const codeMatchesRecorded = account && account.code_hash === RECORDED_CODE;
const alreadyThisWasm = account && codeHash && account.code_hash === codeHash;
const path = alreadyThisWasm ? 'view' : (codeMatchesRecorded ? 'close_then_create' : 'upgrade_then_migrate');

const sendBack = balanceBefore == null ? null : (balanceBefore > GAS_CUSHION ? balanceBefore - GAS_CUSHION : balanceBefore);
const oldWasmFile = 'contracts/artifacts/toll.v6p86.wasm';
const oldWasmBytes = existsSync(oldWasmFile) ? BigInt(readFileSync(oldWasmFile).length) : 0n;
const usageNow = account ? BigInt(account.storage_usage) : BigInt(MAIN.toll.storage_bytes || 0);
const usageAfter = wasm && oldWasmBytes > 0n ? usageNow - oldWasmBytes + BigInt(wasm.length) : (wasm ? BigInt(wasm.length) + 8000n : 0n);
const stakeAfter = usageAfter > 0n ? usageAfter * BYTE : null;
const shopAfter = sendBack != null && stakeAfter != null && sendBack > stakeAfter ? sendBack - stakeAfter : null;
const shortfall = sendBack != null && stakeAfter != null && stakeAfter > sendBack ? stakeAfter - sendBack : 0n;

const transfers = [];
if (path === 'close_then_create' && balanceBefore != null) {
  transfers.push({ step: 'close', method: 'delete_account', payee: payee(OWNER), amount_yocto: balanceBefore.toString(), amount_near: yocto(balanceBefore), note: 'The live wasm cannot upgrade. close() returns every yocto, storage included.' });
  transfers.push({ step: 'create_account', payee: payee(SHOP), amount_yocto: sendBack.toString(), amount_near: yocto(sendBack), note: 'The same NEAR pays the new storage. 0.05 NEAR stays with the owner for gas.' });
}

const init = {
  owner: OWNER,
  mpc: policy?.mpc || 'v1.signer',
  path: policy?.path || 'base-1',
  chain_id: policy?.chain_id || 8453,
  foreign_address: policy?.foreign_address || MAIN.toll.foreign_address,
  fx_root_key: MAIN.fx_root_key,
  allow_to: [],
  max_per_tx: policy?.max_per_tx || null,
  budget: policy?.budget || null,
  max_fee_cap: policy?.max_fee_cap || null,
  verify_chain: policy?.verify_chain || 'Base',
  token: null,
  dao: null,
  gate: null,
};

const fee = process.env.TOLL_FEE_YOCTO || '';
const cost = process.env.TOLL_COST_YOCTO || fee;
const maxToken = process.env.TOLL_MAX_TOKEN || '';
const usdc = process.env.TOLL_USDC || USDC;
const smokeTo = process.env.TOLL_SMOKE_TO || '';
const smokeAmount = process.env.TOLL_SMOKE_AMOUNT || '1';
const smokeOwner = process.env.TOLL_SMOKE_OWNER || OWNER;

const pre = [
  { check: 'account', ok: SHOP === 'toll.nearcarta.near' && !!account, detail: SHOP },
  { check: 'owner', ok: OWNER === 'nearcarta.near' && (!policy || policy.owner === OWNER), detail: policy?.owner || OWNER },
  { check: 'no full-access key', ok: fullAccess === 0, detail: String(fullAccess) },
  { check: 'no visitor NEAR to refund', ok: serviceHeld === 0n, detail: openOrders + ', service_held ' + serviceHeld.toString() },
  { check: 'payees', ok: transfers.every(t => t.payee === OWNER || t.payee === SHOP), detail: transfers.map(t => t.payee).join(', ') || 'none until the path is close' },
  { check: 'init has no allow list', ok: init.allow_to.length === 0, detail: 'allow_to empty' },
  { check: 'wasm', ok: !!wasm, detail: wasmFile || 'not built' },
];
if (path === 'close_then_create') {
  pre.push({ check: 'recorded code', ok: codeMatchesRecorded, detail: account?.code_hash || 'unread' });
  pre.push({ check: 'balance covers the new stake', ok: !!(shopAfter && shopAfter > 0n), detail: stakeAfter ? yocto(stakeAfter) + ' NEAR estimated stake' : 'no wasm' });
}

const report = {
  dry_run: !live,
  network: 'mainnet',
  account: SHOP,
  owner: OWNER,
  board: BOARD,
  path,
  wasm: wasm ? { file: wasmFile, bytes: wasm.length, sha256: sha.toString('hex'), code_hash: codeHash } : null,
  storage: {
    price_yocto_per_byte: BYTE.toString(),
    usage_bytes: account ? account.storage_usage : MAIN.toll.storage_bytes,
    stake_now_near: storageNow != null ? yocto(storageNow) : String(MAIN.toll.locked_near),
    stake_after_near: stakeAfter != null ? yocto(stakeAfter) : null,
    stake_after_note: 'Current storage, minus the live wasm, plus the new wasm. The chain charges the real usage after deploy.',
  },
  balance: {
    shop_before_near: balanceBefore != null ? yocto(balanceBefore) : null,
    shop_before_yocto: balanceBefore != null ? balanceBefore.toString() : null,
    owner_before_near: ownerAccount ? yocto(ownerAccount.amount) : null,
    shop_after_liquid_near: shopAfter != null ? yocto(shopAfter) : null,
    shortfall_near: shortfall > 0n ? yocto(shortfall) : '0',
    recorded_locked_near: MAIN.toll.locked_near,
    view_error: viewError || null,
  },
  transfers,
  prechecks: pre,
  init: path === 'view' ? null : init,
  set_price: fee ? {
    board: BOARD, fee, cost, splits: [], paused: false, usdc, max_token: maxToken, hold_ns: process.env.TOLL_HOLD_NS || '0',
    note: 'usdc is the token contract, not a recipient. No visitor address is stored.',
  } : { skipped: true, note: 'Set TOLL_FEE_YOCTO and TOLL_MAX_TOKEN to publish a fee. Until then the card stays disabled.' },
  post_deploy_view: ['policy', 'address_of'],
  smoke: {
    sends: false,
    view: 'address_of',
    args: { row_owner: smokeOwner, chain: 'base' },
    amount_wei: smokeAmount,
    to: smokeTo || null,
    note: smokeTo
      ? 'Tiny amount only. This script does not submit the crossing. The visitor session calls propose_call_as.'
      : 'Set TOLL_SMOKE_TO to name a destination. This script stores none. Amount is the smallest unit unless TOLL_SMOKE_AMOUNT is set.',
  },
  signer: live ? 'TOLL_SIGNER_KEY is set and is not printed' : 'not read',
};

const failed = pre.filter(p => !p.ok);
console.log(JSON.stringify(report, null, 2));
if (!live) {
  console.log('This command does not sign and does not send NEAR.');
  process.exit(failed.some(p => p.check === 'wasm') ? 1 : 0);
}

const key = process.env.TOLL_SIGNER_KEY || '';
if (!key.startsWith('ed25519:') || key.length < 20) {
  console.error('Refusing: set TOLL_SIGNER_KEY. This script does not read a key file.');
  process.exit(1);
}
if (failed.length) {
  console.error('Refusing: a pre-check failed. Nothing was signed.');
  process.exit(1);
}
if (path === 'close_then_create' && serviceHeld !== 0n) {
  console.error('Refusing: a visitor deposit is still held. Nothing was signed.');
  process.exit(1);
}

const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
const provider = new JsonRpcProvider({ url: RPC });
const signer = new Account(OWNER, provider, KeyPairSigner.fromSecretKey(key));
const TG = 10n ** 12n;

async function send(label, receiverId, actions) {
  const r = await signer.signAndSendTransaction({ receiverId: payee(receiverId), waitUntil: 'FINAL', throwOnFailure: false, actions });
  const hash = r?.transaction?.hash || '';
  const bad = r?.status?.Failure || r?.receipts_outcome?.find(x => x.outcome?.status?.Failure);
  console.log(JSON.stringify({ label, hash, ok: !bad }));
  if (bad) process.exit(1);
  return hash;
}

if (path === 'close_then_create') {
  await send('close', SHOP, [A.functionCall('close', {}, 30n * TG, 1n)]);
  for (let i = 0; i < 20; i++) {
    const still = await viewAccount(SHOP).catch(() => null);
    if (!still) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  const create = [
    A.createAccount(),
    A.transfer(sendBack),
    A.deployContract(wasm),
    A.functionCall('new', init, 80n * TG, 0n),
  ];
  if (fee && maxToken) {
    create.push(A.functionCall('set_price', {
      board: BOARD, fee, cost, splits: [], paused: false, usdc, max_token: maxToken, hold_ns: process.env.TOLL_HOLD_NS || '0',
    }, 30n * TG, 0n));
  }
  await send('create', SHOP, create);
} else if (path === 'upgrade_then_migrate') {
  await send('upgrade', SHOP, [A.functionCall('upgrade', { code: Buffer.from(wasm).toString('base64') }, 200n * TG, 0n)]);
}

const after = await viewAccount(SHOP);
const viewed = await viewCall(SHOP, 'policy', {});
const addr = await viewCall(SHOP, 'address_of', { row_owner: smokeOwner, chain: 'base' });
console.log(JSON.stringify({
  step: 'post_deploy',
  balance_near: yocto(after.amount),
  storage_bytes: after.storage_usage,
  code_hash: after.code_hash,
  policy_path: viewed?.path || null,
  allow_to: viewed?.allow_to || null,
  address_of: addr,
  smoke_amount_wei: smokeAmount,
  smoke_to: smokeTo || null,
  smoke_sent: false,
}, null, 2));
