// Ship the board `anchor` fix to the live board, with a dry run by default.
//
//   node backend/scripts/board-anchor-upgrade.js
//   node backend/scripts/board-anchor-upgrade.js --stage
//   node backend/scripts/board-anchor-upgrade.js --apply
//
// Why this is needed: the deployed wasm has `anchor`, but `load()` on the live board returns
// `read_head` (partial), and `anchor` read the row from memory without hydrating it. On the live
// contract that panics ERR_NO_CHARTER, so the tray would have failed after the visitor pressed
// Anchor. contracts/charter_board_sandbox/tests/anchor.rs reproduces it against the pinned
// artifact and passes on the rebuilt one.
//
// The board has no upgrade-by-deploy method: `stage_upgrade(code_hash)` then, after
// UPGRADE_DELAY_NS (24 h), `upgrade(code)` which checks sha256(code) and calls `migrate` in the
// same receipt. This script follows exactly that. It never signs unless --stage or --apply is
// passed with NEAR_MAINNET_SIGNER_KEY in the environment, and it never prints the key.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

const stage = process.argv.includes('--stage');
const apply = process.argv.includes('--apply');
const live = stage || apply;
const board = MAIN.board?.contract || '';
const root = MAIN.root || '';
const wasmPath = process.env.BOARD_WASM || 'contracts/charter_board/target/near/charter_board.wasm';
const rpc = MAIN.rpc || 'https://free.rpc.fastnear.com';

if (!board || !root) {
  console.error('shared/deployments/mainnet.json needs board.contract and root');
  process.exit(2);
}
if (stage && apply) {
  console.error('Pass one of --stage or --apply, not both.');
  process.exit(2);
}
const file = new URL('../../' + wasmPath, import.meta.url);
if (!existsSync(file)) {
  console.error(`Missing wasm at ${wasmPath}.`);
  console.error('Build it first: cd contracts/charter_board && cargo +1.86.0 build --target wasm32-unknown-unknown --release --lib');
  process.exit(2);
}
const wasm = readFileSync(file);
const sha = createHash('sha256').update(wasm).digest('hex');
const recorded = MAIN.board?.wasm_sha256 || '';
// A staged upgrade is a DIFFERENT artifact from the live one, and `upgrade(code_hash)` must be
// handed exactly the code the owner staged. Comparing only against the live build (as this script
// did) says "the board runs a different build" and says nothing about whether the local wasm is the
// one the pending upgrade expects — which is the only question that matters at the eta. Measured on
// 2026-11-09: the live build is 982bf6b6, the staged build is a89664ef, and a fresh local build
// produced b22b34aa, so none of the three matched and the check looked like a board problem.
const staged = MAIN.board?.upgrade_staged || {};
const stagedSha = staged.wasm_sha256 || staged.sha256 || '';
let stagedShaFromEvent = '';

const post = async (method, params) => {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'nearcarta-board-upgrade' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'board-upgrade', method, params }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.error) throw new Error(`${method}: ${body.error.cause?.name || body.error.name || 'error'}`);
  return body.result;
};

const view = async (method, args = {}) => {
  const out = await post('query', {
    request_type: 'call_function', finality: 'final', account_id: board, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  const text = Buffer.from(out?.result || []).toString('utf8');
  return text ? JSON.parse(text) : null;
};

let eta = null, etaError = '';
// `upgrade_eta` is NOT a contract view: v2.rs has no `#[near]` block, so calling it as one always
// answers MethodNotFound and the pre-flight reported "no eta" for a healthy staged upgrade. The
// authoritative record is the `stage_upgrade` EVENT_JSON the contract logs, which carries both the
// eta and the staged code hash. Read that from the recorded stage transaction instead.
try {
  const stageTx = staged.tx;
  if (stageTx) {
    const t = await post('tx', { tx_hash: stageTx, sender_account_id: root, wait_until: 'FINAL' });
    for (const out of t?.receipts_outcome || []) {
      for (const line of out?.outcome?.logs || []) {
        if (!line.includes('stage_upgrade')) continue;
        const body = JSON.parse(line.replace(/^EVENT_JSON:/, ''));
        if (body.eta) eta = String(body.eta);
        if (body.code_hash) stagedShaFromEvent = String(body.code_hash);
      }
    }
  }
  if (!eta) etaError = 'no stage_upgrade event in the recorded stage transaction';
} catch (e) { etaError = e.message; }
let code = null;
try { code = Buffer.from((await post('query', { request_type: 'view_code', finality: 'final', account_id: board })).code_base64, 'base64'); }
catch { code = null; }
const liveSha = code ? createHash('sha256').update(code).digest('hex') : '';

const report = {
  dry_run: !live,
  mode: stage ? 'stage' : apply ? 'apply' : 'plan',
  network: 'mainnet',
  board,
  owner: root,
  rpc,
  wasm: {
    path: wasmPath, bytes: wasm.length, sha256: sha,
    recorded_sha256: recorded, recorded_matches_build: recorded === sha,
    live_sha256: liveSha, live_matches_build: !!liveSha && liveSha === sha,
    // The question that decides whether `upgrade` can run: is this the artifact that was staged?
    staged_sha256: stagedSha || null,
    staged_matches_build: stagedSha ? stagedSha === sha : null,
    staged_note: stagedSha
      ? (stagedSha === sha
        ? 'this wasm IS the staged artifact; upgrade will accept it after the eta'
        : 'this wasm is NOT the staged artifact; upgrade checks sha256 and will refuse it — point BOARD_WASM at the pinned build the owner staged')
      : 'no staged upgrade recorded in mainnet.json',
  },
  upgrade_eta_ns: eta,
  upgrade_eta: eta ? new Date(Number(BigInt(eta) / 1_000_000n)).toISOString() : null,
  eta_error: etaError || null,
  sends: false,
  steps: [],
};
report.prechecks = [
  { check: 'built wasm is not the live one', ok: !report.wasm.live_matches_build, detail: report.wasm.live_matches_build ? 'the board already runs this build' : 'the board runs a different build' },
  { check: 'wasm has anchor', ok: wasm.includes(Buffer.from('anchor', 'utf8')), detail: 'anchor must be in the deployed code' },
  { check: 'stage is owner-only', ok: true, detail: `${root} must sign; the board refuses any other predecessor` },
  { check: '24 h delay after staging', ok: true, detail: 'UPGRADE_DELAY_NS; upgrade before the eta is refused ERR_UPGRADE' },
];

// The order the owner has to follow. Printed in every mode so the dry run is the instruction.
const now = Date.now();
// If an upgrade is ALREADY staged, the wait is until that eta, not 24 hours from now. The old line
// always added 24 hours to the moment you ran it, so the plan told the owner to wait a day for an
// upgrade that was already 8 hours away.
const etaAfterStage = eta ? Number(BigInt(eta) / 1_000_000n) : now + 24 * 3600 * 1000;
report.steps = [
  { step: '1. stage_upgrade', when: apply ? 'not needed if already staged' : 'now', call: 'stage_upgrade({ code_hash: "' + sha + '" })', deposit: '1 yoctoNEAR', note: 'owner only; logs a stage_upgrade event' },
  { step: '2. wait', when: new Date(etaAfterStage).toISOString(), note: 'the contract refuses upgrade before upgrade_eta' },
  { step: '3. upgrade', when: 'after the eta', call: 'upgrade({ code: "<hex of the same wasm>" })', note: 'checks sha256(code) and calls migrate in the same receipt' },
  { step: '4. verify', when: 'after upgrade', call: 'GET /api/mainnet and view_code sha256', note: 'must equal ' + sha },
];

if ((stage || apply) && !live) {
  report.sends = false;
}

if (live) {
  const key = process.env.NEAR_MAINNET_SIGNER_KEY || '';
  if (!key.startsWith('ed25519:')) {
    console.error('Refusing to sign: set NEAR_MAINNET_SIGNER_KEY to the ed25519 secret of ' + root + '. This script reads no key file.');
    process.exit(1);
  }
  const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
  const signer = new Account(root, new JsonRpcProvider({ url: rpc }), KeyPairSigner.fromSecretKey(key));
  const TG = 10n ** 12n;
  report.sends = true;
  if (stage) {
    const r = await signer.signAndSendTransaction({
      receiverId: board, waitUntil: 'FINAL', throwOnFailure: false,
      actions: [A.functionCall('stage_upgrade', { code_hash: sha }, 30n * TG, 1n)],
    });
    const bad = r.status?.Failure || r.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
    report.stage = { tx: r.transaction.hash, ok: !bad, failure: bad ? JSON.stringify(bad).slice(0, 200) : null };
    if (bad) { console.log(JSON.stringify(report, null, 1)); process.exit(1); }
  } else {
    if (report.wasm.live_matches_build) { console.error('The board already runs this build.'); process.exit(1); }
    if (!eta) { console.error('Nothing is staged: run --stage first. ' + (etaError || '')); process.exit(1); }
    if (BigInt(eta) > BigInt(Date.now()) * 1_000_000n) {
      console.error(`The staged upgrade is not due until ${report.upgrade_eta}. The board would refuse it.`);
      process.exit(1);
    }
    const r = await signer.signAndSendTransaction({
      receiverId: board, waitUntil: 'FINAL', throwOnFailure: false,
      actions: [A.functionCall('upgrade', { code: Buffer.from(wasm).toString('hex') }, 300n * TG, 0n)],
    });
    const bad = r.status?.Failure || r.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
    report.apply = { tx: r.transaction.hash, ok: !bad, failure: bad ? JSON.stringify(bad).slice(0, 200) : null };
    if (bad) { console.log(JSON.stringify(report, null, 1)); process.exit(1); }
  }
}

console.log(JSON.stringify(report, null, 1));
if (!live) console.log('This command does not sign and does not send NEAR.');
