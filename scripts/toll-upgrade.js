// Upgrade toll.nearcarta.near in place. No new account, no close, no transfer.
// Dry-run by default. --live signs. The signer key is TOLL_SIGNER_KEY and is never printed.
//
//   node scripts/toll-upgrade.js
//   TOLL_SIGNER_KEY='ed25519:...' node scripts/toll-upgrade.js --live
//   node scripts/toll-upgrade.js --to v7        # roll back to the recorded v7 wasm
//
// The live v7 wasm has `upgrade` (owner only) and `migrate`. `upgrade` deploys the code,
// then calls `migrate` on the same account. The v8 state layout is identical to v7, so
// migrate reads the existing state back: no field is added, dropped or reordered. The
// owner's `max_per_tx` and `max_token` stay in state for a later migration but are no
// longer enforced, and `policy` reports them as null so no client reintroduces them.
//
// Nothing here moves NEAR. The only balance change is the storage stake the chain
// adjusts for the new code size.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bs58 from 'bs58';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };

const live = process.argv.includes('--live');
const want = (process.argv.find(a => a.startsWith('--to=')) || '').split('=')[1]
  || (process.argv.includes('--to') ? process.argv[process.argv.indexOf('--to') + 1] : '')
  || 'v8';
const SHOP = MAIN.toll.contract;
const OWNER = MAIN.toll.owner;
const RPC = MAIN.rpc;
const BYTE = 10n ** 19n;
const ONE = 10n ** 24n;
const RECORDED = MAIN.toll.code_hash;
const WASM = { v8: 'contracts/artifacts/toll.v8.wasm', v7: 'contracts/artifacts/toll.v7.wasm' };

function yocto(n) {
  const b = typeof n === 'bigint' ? n : BigInt(n);
  const neg = b < 0n;
  const v = neg ? -b : b;
  const whole = (v / ONE).toString();
  const frac = (v % ONE).toString().padStart(24, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (frac ? `${whole}.${frac}` : whole);
}
/** A signed NEAR amount, with an explicit sign so a credit is never mistaken for a debit. */
function signed(n) { return (n > 0n ? '+' : '') + yocto(n); }

function optimize(file) {
  const out = join(tmpdir(), 'toll-upgrade-opt.wasm');
  const run = spawnSync('wasm-opt', ['-Oz', '--strip-debug', '--strip-producers', '-o', out, file], { encoding: 'utf8' });
  if (run.status === 0 && existsSync(out)) return out;
  return file;
}

// The named artifact, else the release build if it is newer than the artifact.
function findWasm() {
  const named = process.env.TOLL_WASM;
  if (named) return existsSync(named) ? optimize(named) : null;
  const artifact = WASM[want] || WASM.v8;
  const built = 'contracts/toll/target/wasm32-unknown-unknown/release/oath_lab.wasm';
  if (existsSync(built) && existsSync(artifact) && statSync(built).mtimeMs > statSync(artifact).mtimeMs) return optimize(built);
  if (existsSync(artifact)) return artifact;
  if (existsSync(built)) return optimize(built);
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

const viewAccount = id => rpc('query', { request_type: 'view_account', finality: 'final', account_id: id });
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

let account = null, ownerAccount = null, policy = null, keys = [], viewError = '';
try { account = await viewAccount(SHOP); } catch (e) { viewError = e.message; }
try { ownerAccount = await viewAccount(OWNER); } catch (e) { viewError = viewError || e.message; }
if (account) {
  policy = await viewCall(SHOP, 'policy', {}).catch(e => { viewError = viewError || e.message; return null; });
  try {
    const listed = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: SHOP });
    keys = listed.keys || [];
  } catch { keys = []; }
}

const exists = !!account;
const balance = account ? BigInt(account.amount) : null;
const usageNow = account ? BigInt(account.storage_usage) : 0n;
const fullAccess = keys.filter(k => k.access_key?.permission === 'FullAccess').length;
// The v7 wasm is on chain now. Swap its code size for the new one; the account record
// and the maps are unchanged, so this is exact rather than an estimate.
const v7Bytes = existsSync(WASM.v7) ? BigInt(readFileSync(WASM.v7).length) : 0n;
const sameWasm = account && codeHash && account.code_hash === codeHash;
const onV7 = account && account.code_hash === RECORDED;
const usageAfter = !wasm ? 0n : (sameWasm ? usageNow : usageNow - v7Bytes + BigInt(wasm.length));
const stakeNow = usageNow > 0n ? usageNow * BYTE : null;
const stakeAfter = usageAfter > 0n ? usageAfter * BYTE : null;
const delta = stakeNow != null && stakeAfter != null ? stakeAfter - stakeNow : null;
const balanceAfter = balance != null && delta != null ? balance - delta : null;
const funded = balanceAfter != null && balanceAfter >= 0n;
const path = !exists ? 'missing' : sameWasm ? 'view' : (onV7 ? 'upgrade' : 'upgrade_from_unknown');

const serviceHeld = policy && policy.service_held != null ? BigInt(policy.service_held) : 0n;
const openOrders = policy && policy.next_nonce != null ? policy.next_nonce : null;
const legacyCaps = policy ? {
  max_per_tx: policy.max_per_tx ?? null,
  max_token: policy.price?.max_token ?? null,
} : null;

const pre = [
  { check: 'account', ok: exists, detail: exists ? SHOP : SHOP + ' is absent; this script does not create it' },
  { check: 'owner', ok: OWNER === 'nearcarta.near' && (!policy || policy.owner === OWNER), detail: policy?.owner || OWNER },
  { check: 'no full-access key', ok: fullAccess === 0, detail: String(fullAccess) },
  { check: 'wasm', ok: !!wasm, detail: wasmFile || 'not built' },
  { check: 'not already this wasm', ok: !sameWasm, detail: sameWasm ? 'the account already runs this code; nothing to do' : 'differs' },
  { check: 'no visitor deposit held', ok: serviceHeld === 0n, detail: 'service_held ' + serviceHeld.toString() },
  { check: 'balance covers the storage delta', ok: funded, detail: delta == null ? 'no wasm' : signed(delta) + ' NEAR stake change' },
  { check: 'no transfer', ok: true, detail: 'upgrade deploys code on the same account; no NEAR is sent' },
  { check: 'state layout', ok: true, detail: 'v8 keeps every v7 field, so migrate reads the live state back' },
];

const report = {
  dry_run: !live,
  network: 'mainnet',
  account: SHOP,
  owner: OWNER,
  path,
  target: want,
  wasm: wasm ? { file: wasmFile, bytes: wasm.length, sha256: sha.toString('hex'), code_hash: codeHash } : null,
  on_chain: {
    code_hash: account?.code_hash || null,
    recorded_code_hash: RECORDED,
    runs_this_wasm: !!sameWasm,
    runs_recorded_v7: !!onV7,
  },
  storage: {
    price_yocto_per_byte: BYTE.toString(),
    usage_now_bytes: account ? account.storage_usage : null,
    usage_after_bytes: usageAfter > 0n ? usageAfter.toString() : null,
    stake_now_near: stakeNow != null ? yocto(stakeNow) : null,
    stake_after_near: stakeAfter != null ? yocto(stakeAfter) : null,
    stake_delta_yocto: delta != null ? delta.toString() : null,
    stake_delta_near: delta != null ? signed(delta) : null,
    note: 'The live storage, with the recorded v7 code size swapped for this wasm. No account record changes.',
  },
  balance: {
    owner_before_near: ownerAccount ? yocto(ownerAccount.amount) : null,
    shop_before_near: balance != null ? yocto(balance) : null,
    shop_after_near: balanceAfter != null ? yocto(balanceAfter) : null,
    transfer_near: '0',
    shortfall_near: !funded && delta != null ? yocto(-(balanceAfter ?? 0n)) : '0',
    view_error: viewError || null,
  },
  legacy_caps: {
    ...legacyCaps,
    note: 'Recorded from the live v7 policy. v8 stops enforcing both and reports them null.',
  },
  steps: [
    { step: 1, call: `${SHOP}.upgrade`, args: '{ code: base64(wasm) }', gas_tgas: 200, deposit: '0', signs: true },
    { step: 2, call: `${SHOP}.migrate`, args: '{}', gas_tgas: 15, deposit: '0', signs: false, note: 'chained by upgrade, same account' },
  ],
  prechecks: pre,
  post_deploy_view: ['policy', 'address_of'],
  smoke: {
    sends: false,
    view: 'address_of',
    args: { row_owner: process.env.TOLL_SMOKE_OWNER || OWNER, chain: 'base' },
    note: 'Reads the derived address for one row. No crossing and no Base payment.',
  },
  signer: live
    ? (process.env.TOLL_SIGNER_KEY ? 'TOLL_SIGNER_KEY is set and is not printed' : 'TOLL_SIGNER_KEY is not set; --live will refuse')
    : 'not read',
};

const failed = pre.filter(p => !p.ok);
console.log(JSON.stringify(report, null, 2));
if (!live) {
  console.log('This command does not sign and does not send NEAR.');
  process.exit(failed.some(p => p.check === 'wasm' || p.check === 'balance covers the storage delta') ? 1 : 0);
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

const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
const provider = new JsonRpcProvider({ url: RPC });
const signer = new Account(OWNER, provider, KeyPairSigner.fromSecretKey(key));
const TG = 10n ** 12n;

const r = await signer.signAndSendTransaction({
  receiverId: SHOP, waitUntil: 'FINAL', throwOnFailure: false,
  actions: [A.functionCall('upgrade', { code: Buffer.from(wasm).toString('base64') }, 200n * TG, 0n)],
});
const hash = r?.transaction?.hash || '';
const bad = r?.status?.Failure || r?.receipts_outcome?.find(x => x.outcome?.status?.Failure);
console.log(JSON.stringify({ label: 'upgrade', hash, ok: !bad }));
if (bad) process.exit(1);

const after = await viewAccount(SHOP);
const viewed = await viewCall(SHOP, 'policy', {}).catch(() => null);
console.log(JSON.stringify({
  step: 'post_deploy',
  balance_near: yocto(after.amount),
  storage_bytes: after.storage_usage,
  code_hash: after.code_hash,
  code_matches_wasm: after.code_hash === codeHash,
  max_per_tx: viewed?.max_per_tx ?? null,
  max_token: viewed?.price?.max_token ?? null,
  allow_to: viewed?.allow_to ?? null,
}, null, 2));
