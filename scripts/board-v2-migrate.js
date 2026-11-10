// Move the live board to v2, and retire charter.nearcarta.near first so the
// owner can pay the new stake. Dry-run by default. It does not sign.
//
//   node scripts/board-v2-migrate.js
//   NEAR_MAINNET_SIGNER_KEY='ed25519:...' node scripts/board-v2-migrate.js --live
//
// The key is the environment only. It is never printed.
// Money moves only to the open row's owner or to nearcarta.near.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };
import { deployCost, MAX_DEPLOY_YOCTO } from '../shared/board/cost.js';

const live = process.argv.includes('--live');
const ROOT = MAIN.root;
const BOARD = MAIN.board.contract;
const CHARTER = MAIN.charter.contract;
const VISITOR = MAIN.board.visitor_run.signer;
const REAPER_SHA = MAIN.wasm_sha256['reaper.p86'];
const DELAY_S = MAIN.charter.policy_delay_s;
const reaper = readFileSync(new URL('../contracts/artifacts/reaper.p86.wasm', import.meta.url));
const wasm = readFileSync(new URL('../' + MAIN.board.wasm, import.meta.url));
const reaperSha = createHash('sha256').update(reaper).digest('hex');
const wasmSha = createHash('sha256').update(wasm).digest('hex');
const cost = deployCost(wasm.length, ROOT);

function fail(msg) {
  console.error('Refusing: ' + msg);
  process.exit(1);
}

if (MAIN.charter.owner !== ROOT) fail('charter.owner is not ' + ROOT);
if (MAIN.board.owner !== ROOT) fail('board.owner is not ' + ROOT);
if (reaperSha !== REAPER_SHA) fail('reaper.p86.wasm sha256 does not match mainnet.json reaper.p86');
if (!VISITOR || VISITOR === ROOT || VISITOR === BOARD || VISITOR === CHARTER) fail('the open row owner is not a visitor account');
if (cost.totalYocto > MAX_DEPLOY_YOCTO || cost.peakYocto > MAX_DEPLOY_YOCTO) fail('deploy is over the 2.1 NEAR maximum');

const payees = [
  { step: 'board force_close', to: VISITOR, what: 'the open row balance and its storage' },
  { step: 'charter reap', to: ROOT, what: 'the charter account, after the reaper is installed' },
  { step: 'board reap', to: ROOT, what: 'the board account, only after rows is 0' },
  { step: 'recreate board', to: BOARD, what: 'the owner stake for the new account' },
];
for (const p of payees) {
  if (p.to !== VISITOR && p.to !== ROOT && p.to !== BOARD) fail(p.step + ' pays ' + p.to);
}

const plan = {
  dry_run: !live,
  signer: ROOT,
  owner_check: { charter: MAIN.charter.owner, board: MAIN.board.owner, required: ROOT },
  wasm: { bytes: wasm.length, sha256: wasmSha, cap_yocto: MAX_DEPLOY_YOCTO.toString(), stake_yocto: cost.stakeYocto.toString(), total_yocto: cost.totalYocto.toString(), peak_yocto: cost.peakYocto.toString() },
  payees,
  steps: [
    { n: 0, account: CHARTER, method: 'queue_upgrade', args: { code_hash: reaperSha }, signer: ROOT, note: 'reaper wasm sha256' },
    { n: 1, wait_s: DELAY_S, note: 'policy_delay_s on the charter. The oath then needs execute_change before upgrade will accept the hash.' },
    { n: 2, account: CHARTER, method: 'execute_change', args: { change_id: '<id from queue_upgrade>' }, signer: ROOT, note: 'marks the hash ready (eta 0). upgrade reverts without this.' },
    { n: 3, account: CHARTER, method: 'upgrade', args: 'raw reaper.p86.wasm bytes, not JSON', signer: ROOT },
    { n: 4, account: CHARTER, method: 'reap', deposit_yocto: '1', signer: ROOT, pays: ROOT, note: 'owner() on the reaper must be ' + ROOT + ' or this step is refused' },
    { n: 5, account: BOARD, method: 'force_close', args: { visitor: VISITOR }, signer: ROOT, pays: VISITOR, note: 'same refund as close_charter. Refused unless get_config.rows is 1 and this visitor has the row.' },
    { n: 6, account: BOARD, method: 'reap', deposit_yocto: '1', signer: ROOT, pays: ROOT, note: 'refused unless rows is 0' },
    { n: 7, account: BOARD, method: 'createAccount + transfer + deployContract + new', signer: ROOT, pays: BOARD, stake_yocto: cost.stakeYocto.toString() },
    { n: 8, account: BOARD, method: 'get_config', note: 'owner ' + ROOT + ', rows 0. No third-party transfer.' },
  ],
};

console.log(JSON.stringify(plan, null, 2));
if (!live) {
  console.log('This command does not sign and does not send NEAR.');
  process.exit(0);
}

const key = process.env.NEAR_MAINNET_SIGNER_KEY || '';
if (!key.startsWith('ed25519:')) fail('set NEAR_MAINNET_SIGNER_KEY to the ed25519 secret of ' + ROOT + '. This script does not read a key file.');

const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
const rpc = new JsonRpcProvider({ url: MAIN.rpc });
const signer = new Account(ROOT, rpc, KeyPairSigner.fromSecretKey(key));
const TG = 10n ** 12n;

async function view(account, method, args) {
  return rpc.callFunction({ contractId: account, method, args: args || {}, blockQuery: { finality: 'final' } });
}
async function accountOf(id) {
  return rpc.query({ request_type: 'view_account', finality: 'final', account_id: id });
}
function hashOf(r) {
  return r?.transaction?.hash || r?.transaction_outcome?.id || '';
}
async function send(label, receiver, actions) {
  const r = await signer.signAndSendTransaction({ receiverId: receiver, waitUntil: 'FINAL', throwOnFailure: false, actions });
  const hash = hashOf(r);
  const bad = r?.status?.Failure || r?.receipts_outcome?.find(x => x.outcome?.status?.Failure);
  console.log(JSON.stringify({ label, hash, ok: !bad }));
  if (bad) fail(label + ' failed: ' + hash);
  return r;
}

const charterState = await view(CHARTER, 'get_state', {});
if (charterState?.owner !== ROOT) fail('live charter owner is ' + charterState?.owner);
const boardConfig = await view(BOARD, 'get_config', {});
if (boardConfig?.owner !== ROOT) fail('live board owner is ' + boardConfig?.owner);
if (String(boardConfig?.rows) !== '1') fail('board rows is ' + boardConfig?.rows + ', expected 1');
const row = await view(BOARD, 'get_charter', { owner: VISITOR });
if (!row || row.owner !== VISITOR) fail('the known visitor has no row');

const queued = await send('charter queue_upgrade', CHARTER, [A.functionCall('queue_upgrade', { code_hash: reaperSha }, 80n * TG, 0n)]);
const queuedValue = queued?.status?.SuccessValue;
let changeId = null;
try {
  const parsed = JSON.parse(Buffer.from(queuedValue || '', 'base64').toString('utf8'));
  changeId = parsed?.queued ?? parsed?.change_id ?? null;
} catch { changeId = null; }
if (changeId == null) fail('queue_upgrade did not return a change id');
console.log(JSON.stringify({ wait_s: DELAY_S, change_id: String(changeId) }));
await new Promise(r => setTimeout(r, Number(DELAY_S) * 1000));
await send('charter execute_change', CHARTER, [A.functionCall('execute_change', { change_id: String(changeId) }, 80n * TG, 0n)]);
await send('charter upgrade', CHARTER, [A.functionCall('upgrade', new Uint8Array(reaper), 300n * TG, 0n)]);
const reaperOwner = await view(CHARTER, 'owner', {});
const ownerText = String(reaperOwner).replace(/"/g, '');
if (ownerText !== ROOT) fail('reaper owner is ' + ownerText);
await send('charter reap', CHARTER, [A.functionCall('reap', {}, 80n * TG, 1n)]);

await send('board force_close', BOARD, [A.functionCall('force_close', { visitor: VISITOR }, 80n * TG, 1n)]);
const after = await view(BOARD, 'get_config', {});
if (String(after?.rows) !== '0') fail('a row is still open');
await send('board reap', BOARD, [A.functionCall('reap', {}, 80n * TG, 1n)]);

await send('board recreate', BOARD, [
  A.createAccount(),
  A.transfer(cost.stakeYocto),
  A.deployContract(new Uint8Array(wasm)),
  A.functionCall('new', {}, 80n * TG, 0n),
]);
const created = await view(BOARD, 'get_config', {});
console.log(JSON.stringify({ verify: created, wasm_sha256: wasmSha }));
if (created?.owner !== ROOT || String(created?.rows) !== '0') fail('new board config is not empty under ' + ROOT);
const gone = await accountOf(CHARTER).then(() => false).catch(() => true);
if (!gone) fail('charter account still exists');
