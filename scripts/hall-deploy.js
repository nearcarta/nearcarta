// Redeploy Town Hall on the existing shop account.
// Dry-run by default: reads chain state, prints the plan, does not sign.
//
//   node scripts/hall-deploy.js
//   HALL_SIGNER_KEY='ed25519:...' node scripts/hall-deploy.js --live
//   HALL_SMOKE_A=a.near HALL_SMOKE_B=b.near node scripts/hall-deploy.js
//
// The key is read from the environment only. It is never printed and never read from a file.
// Step 1 refunds each open bounty to the signer of the transaction that posted it.
// Step 2 deploys contracts/hall and calls migrate (clean state).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };
import { hallDeployPlan, MIGRATE_TGAS } from '../shared/hall/deploy-plan.js';

const live = process.argv.includes('--live');
if (process.argv.some(a => String(a).includes('ed25519:'))) {
  console.error('Refusing: a key was passed on the command line.');
  process.exit(1);
}

const shop = MAIN.extras.townhall.contract;
const owner = MAIN.extras.townhall.owner;
const board = MAIN.board.contract;
const rpcUrl = MAIN.rpc;
const oldWasmPath = new URL('../contracts/artifacts/townhall.p86.wasm', import.meta.url);
const newWasmPath = new URL('../contracts/artifacts/hall.wasm', import.meta.url);
const builtWasmPath = new URL('../contracts/hall/target/wasm32-unknown-unknown/release/hall.wasm', import.meta.url);
let wasmFile = newWasmPath;

function ensureWasm() {
  if (!existsSync(newWasmPath)) {
    const built = spawnSync('cargo', ['+1.86.0', 'build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--manifest-path', 'contracts/hall/Cargo.toml'], { stdio: 'inherit' });
    if (built.status !== 0 || !existsSync(builtWasmPath)) {
      console.error('Missing hall wasm. cargo build did not produce it.');
      process.exit(1);
    }
    const opt = process.env.WASM_OPT || 'wasm-opt';
    const ran = spawnSync(opt, ['-Oz', '--strip-debug', '--strip-producers', builtWasmPath.pathname, '-o', newWasmPath.pathname], { stdio: 'ignore' });
    if (ran.status !== 0) {
      spawnSync('cp', [builtWasmPath.pathname, newWasmPath.pathname]);
    }
  }
  wasmFile = newWasmPath;
  return wasmFile;
}

async function rpc(method, params) {
  const r = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}

function decodeView(result) {
  const bytes = Uint8Array.from(result.result);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function view(method, args) {
  const res = await rpc('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: shop,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args || {})).toString('base64'),
  });
  return decodeView(res);
}

async function account() {
  return rpc('query', { request_type: 'view_account', finality: 'final', account_id: shop });
}

async function accessKeys() {
  return rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: shop });
}

async function postingTx(hash) {
  const r = await fetch('https://api.nearblocks.io/v1/txns/' + hash, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error('tx lookup ' + r.status + ' for ' + hash);
  const body = await r.json();
  const tx = body.txns?.[0];
  const action = tx?.actions?.find(a => a.method === 'post_bounty') || tx?.actions?.[0];
  let args = {};
  try { args = JSON.parse(action?.args || '{}'); } catch { args = {}; }
  return {
    tx: hash,
    signer: tx?.signer_account_id,
    receiver: tx?.receiver_account_id,
    method: action?.method,
    amount: args.amount,
    bountyHash: args.hash_hex,
  };
}

function smokeWorkers() {
  return [process.env.HALL_SMOKE_A, process.env.HALL_SMOKE_B].map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
}

function printPlan(plan) {
  console.log('Shop: ' + plan.shop);
  console.log('Owner: ' + plan.owner);
  console.log('Board: ' + plan.board);
  console.log('Dao: ' + plan.dao);
  console.log('Wasm: contracts/artifacts/hall.wasm (' + plan.wasm.bytes + ' bytes, sha256 ' + plan.wasm.sha256 + ')');
  console.log('Storage now: ' + plan.storage.bytesNow + ' bytes, stake ' + plan.storage.stakeNow + ' yoctoNEAR (' + plan.storage.stakeNowNear + ' NEAR)');
  console.log('Storage after: ' + plan.storage.bytesAfter + ' bytes, stake ' + plan.storage.stakeAfter + ' yoctoNEAR (' + plan.storage.stakeAfterNear + ' NEAR)');
  console.log('  this is the peak during the tx. migrate drops the old bounty and state records, so the settled stake is lower.');
  console.log('Balance before: ' + plan.balance.before + ' yoctoNEAR (' + plan.balance.beforeNear + ' NEAR)');
  console.log('Refund: ' + plan.balance.refund + ' yoctoNEAR (' + plan.balance.refundNear + ' NEAR)');
  console.log('Burned gas estimate: ' + plan.balance.burnedGas + ' yoctoNEAR');
  console.log('Prepaid deploy gas: ' + plan.balance.prepaidDeploy + ' yoctoNEAR (' + plan.balance.prepaidDeployNear + ' NEAR, ' + MIGRATE_TGAS + ' Tgas of it attached to migrate; the unused part is refunded in the same tx)');
  console.log('Balance after: ' + plan.balance.after + ' yoctoNEAR (' + plan.balance.afterNear + ' NEAR)');
  console.log('Liquid after: ' + plan.balance.liquidAfter + ' yoctoNEAR (' + plan.balance.liquidAfterNear + ' NEAR)');
  console.log('Shortfall: ' + plan.balance.shortfall + ' yoctoNEAR (' + plan.balance.shortfallNear + ' NEAR)');
  if (plan.balance.shortfall !== '0') {
    console.log('Top-up, not signed by this script: ' + plan.owner + ' transfers at least ' + plan.balance.shortfall + ' yoctoNEAR to ' + plan.shop + ', then run this command again.');
    console.log('  exact:  near send ' + plan.owner + ' ' + plan.shop + ' ' + plan.balance.shortfallNear);
    console.log('  rounded: near send ' + plan.owner + ' ' + plan.shop + ' ' + plan.balance.recommendedTopUpNear + ' (leaves liquid NEAR for new STATE keys and the smoke deposit)');
  }
  if (plan.transfers.length === 0) console.log('Transfers: none');
  for (const t of plan.transfers) {
    console.log('Transfer: ' + t.amount + ' yoctoNEAR to ' + t.payee + ' (' + t.reason + ', source ' + t.sourceTx + ')');
  }
  const payees = [...new Set([plan.owner, plan.shop, ...plan.transfers.map(t => t.payee)])];
  console.log('Payees in this plan: ' + payees.join(', '));
  for (const step of plan.steps) {
    console.log('Step ' + step.n + ': ' + step.name);
    for (const pre of step.pre || []) console.log('  pre-check: ' + pre);
    if (step.method) console.log('  call: ' + step.method + ' ' + JSON.stringify(step.args || step.expect || {}));
    if (step.n === 4) {
      if (step.skipped) console.log('  smoke skipped. ' + step.note + ' Deposit would be ' + step.deposit + ' yoctoNEAR.');
      else {
        for (const call of step.calls) console.log('  smoke ' + call.method + ' deposit ' + call.deposit + ' args ' + JSON.stringify(call.args));
      }
    }
  }
  for (const check of plan.checks) console.log((check.ok ? 'ok ' : 'NO ') + check.label);
}

async function gather() {
  const wasmFile = ensureWasm();
  const wasm = readFileSync(wasmFile);
  const old = readFileSync(oldWasmPath);
  const oldSha = createHash('sha256').update(old).digest('hex');
  if (oldSha !== MAIN.extras.townhall.sha256) {
    console.error('The stored oath wasm does not match mainnet.json.');
    process.exit(1);
  }
  const [acct, keys, state, bounties] = await Promise.all([
    account(), accessKeys(), view('get_state', {}), view('get_bounties', {}),
  ]);
  const full = (keys.keys || []).filter(k => k.access_key?.permission === 'FullAccess');
  const labels = Object.entries(MAIN.extras.townhall.txs).filter(([name]) => name.includes('post_bounty'));
  const posts = [];
  for (const [, hash] of labels) posts.push(await postingTx(hash));
  const rows = bounties.map(([hash, row]) => ({ hash, amount: row.amount, claimed_by: row.claimed_by }));
  return hallDeployPlan({
    shop, owner, board, dao: state.dao,
    balanceYocto: acct.amount,
    storageBytes: acct.storage_usage,
    oldWasmBytes: old.length,
    newWasmBytes: wasm.length,
    wasmSha256: createHash('sha256').update(wasm).digest('hex'),
    bounties: rows,
    posts,
    fullAccessKeys: full.length || (keys.keys || []).filter(k => k.access_key?.permission === 'FullAccess').length,
    codeHash: acct.code_hash,
    oldCodeHash: MAIN.extras.townhall.code_hash,
    smokeWorkers: smokeWorkers().filter(id => id !== shop && id !== board),
  });
}

const plan = await gather();
printPlan(plan);
if (!plan.ok) {
  console.error('Refusing: a pre-check failed. Nothing was signed.');
  process.exit(1);
}
if (!live) {
  console.log('This command does not sign and does not send NEAR.');
  process.exit(0);
}

const key = process.env.HALL_SIGNER_KEY || '';
if (!key.startsWith('ed25519:')) {
  console.error('Refusing to sign: set HALL_SIGNER_KEY to the ed25519 secret of ' + shop + '. This script does not read a key file.');
  process.exit(1);
}
const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
const signer = new Account(shop, new JsonRpcProvider({ url: rpcUrl }), KeyPairSigner.fromSecretKey(key));
const pub = (await signer.signer.getPublicKey()).toString();
const keys = await accessKeys();
const listed = (keys.keys || []).some(k => k.public_key === pub && (k.access_key?.permission === 'FullAccess'));
if (!listed) {
  console.error('Refusing to sign: HALL_SIGNER_KEY is not a full-access key on ' + shop + '.');
  process.exit(1);
}
const TG = 10n ** 12n;
for (const t of plan.transfers) {
  const r = await signer.signAndSendTransaction({
    receiverId: t.payee,
    waitUntil: 'FINAL',
    throwOnFailure: false,
    actions: [A.transfer(BigInt(t.amount))],
  });
  const bad = r.status?.Failure || r.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
  console.log('Refund ' + (bad ? 'FAILED ' : 'OK ') + (r.transaction?.hash || '') + ' to ' + t.payee);
  if (bad) process.exit(1);
}
const wasm = readFileSync(wasmFile);
const migrated = await signer.signAndSendTransaction({
  receiverId: shop,
  waitUntil: 'FINAL',
  throwOnFailure: false,
  actions: [
    A.deployContract(new Uint8Array(wasm)),
    A.functionCall('migrate', { owner, board }, MIGRATE_TGAS * TG, 0n),
  ],
});
const badDeploy = migrated.status?.Failure || migrated.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
console.log('Deploy ' + (badDeploy ? 'FAILED ' : 'OK ') + (migrated.transaction?.hash || ''));
if (badDeploy) process.exit(1);
const hall = await view('get_hall', {});
console.log('View get_hall: ' + JSON.stringify(hall));
const workers = smokeWorkers().filter(id => id !== shop && id !== board);
if (workers.length < 1) {
  console.log('Smoke skipped. Set HALL_SMOKE_A and HALL_SMOKE_B.');
  process.exit(0);
}
const deadline = String((BigInt(Date.now()) * 1_000_000n) + 86_400_000_000_000n);
const posted = await signer.signAndSendTransaction({
  receiverId: shop,
  waitUntil: 'FINAL',
  throwOnFailure: false,
  actions: [A.functionCall('post_job', {
    row_owner: shop, task: 'smoke', parts: 1, deadline, workers, idempotency: 'hall-smoke',
  }, 80n * TG, 10n ** 21n)],
});
console.log('Smoke post ' + (posted.transaction?.hash || ''));
const job = await view('get_hall', {});
const id = String((BigInt(job.next_id) - 1n));
const refunded = await signer.signAndSendTransaction({
  receiverId: shop,
  waitUntil: 'FINAL',
  throwOnFailure: false,
  actions: [A.functionCall('refund', { row_owner: shop, job_id: id }, 30n * TG, 0n)],
});
console.log('Smoke refund ' + (refunded.transaction?.hash || '') + ' job ' + id);
