import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { deployCost, initStateBytes, MAX_DEPLOY_YOCTO, storageBytes } from '../../../shared/board/cost.js';
import { proposalMessage } from '../../../shared/board/message.js';
import { proposalMessage as shopMessage } from '../../../app/design/D8_shops/js/board.js';
import { setupJourney } from '../../../shared/setup/path.js';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };
import { otherNet, otherEvm, retiredNet } from '../../../shared/net/word-scan.js';

const wasm = readFileSync(new URL('../../../' + MAIN.board.wasm, import.meta.url));

// Live figures (2026-11-05 redeploy, /workspace/audit/board-redeploy-final.json):
// wasm 108955 B, sha256 910268dab146a99f766ebf400c464672bdb46adc3c914a91594a768b1b2e0f29,
// code_hash Am4FLfphc4JF7ZZLRrs3j1otwyKyiQZqygBJ8nnZs78C, deploy tx CfdUppnLoLmFhcvLcgqE93XDygXCpwfPKdL7DHPUqV4.
test('the board wasm deploys for at most 2.1 NEAR and the state size matches the contract', () => {
  assert.equal(wasm.length, 135657);
  assert.equal(createHash('sha256').update(wasm).digest('hex'), '9e8f3d30f6f0ec8b93750a7af55d154926b6896fbabdc4137965ab9d53b260b6');
  assert.ok(deployCost(wasm.length, 'nearcarta.near').stakeYocto > 10n ** 24n, 'storage stake is over 1 NEAR on this wasm');
  assert.equal(initStateBytes('nearcarta.near'), 30);
  const cost = deployCost(wasm.length, 'nearcarta.near');
  assert.equal(cost.storageBytes, storageBytes(wasm.length, 'nearcarta.near'));
  assert.ok(cost.stakeYocto > 0n);
  assert.ok(cost.totalYocto <= MAX_DEPLOY_YOCTO, cost.totalYocto.toString());
  assert.ok(cost.peakYocto <= MAX_DEPLOY_YOCTO, cost.peakYocto.toString());
  assert.equal(cost.totalYocto, cost.stakeYocto + cost.burnedGasYocto + cost.accountCreationYocto);
  assert.equal(MAIN.board.status, 'deployed');
  assert.equal(MAIN.board.full_access_keys, 0);
  // close_charter on the live wasm: smoke close H4RE9oEuELfVQr4C7tcihuNb5Ysh6n2gRYmS8ugL2Vtf (nearblocks).
  assert.equal(MAIN.board.txs.smoke_close_charter, 'H4RE9oEuELfVQr4C7tcihuNb5Ysh6n2gRYmS8ugL2Vtf');
  // The simulate build is live: recreate GPdvDdsKJAobn2wBMGQSgAmJiphV15F5fz84w3NMyXgs (135899 B, 0 keys). The live hash is the artifact.
  assert.equal(MAIN.board.code_hash, 'Bfx6fDuYcZNQTF36ZhZAVB3LSNQGELfNvsWNzSCA3uJD');
  assert.equal(deployCost(wasm.length, 'nearcarta.near').storageBytes, 135899n, 'the recreate measured exactly this');
  assert.equal(MAIN.board.wasm_sha256, createHash('sha256').update(wasm).digest('hex'));
  assert.equal(MAIN.board.previous.code_hash, 'Am4FLfphc4JF7ZZLRrs3j1otwyKyiQZqygBJ8nnZs78C');
  assert.equal(MAIN.board.owner, MAIN.root);
  assert.equal(MAIN.board.max_row_yocto, '30000000000000000000000');
  assert.match(readFileSync(new URL('../../../contracts/charter_board/src/lib.rs', import.meta.url), 'utf8'), /fn reap/);
  assert.match(readFileSync(new URL('../../../docs/MAINNET_BOARD.md', import.meta.url), 'utf8'), /close_charter/);
});

test('the proposal message matches the contract and the shop copy', () => {
  const msg = proposalMessage({ contract: 'charters.nearcarta.near', owner: 'alice.near', receiver: 'shop.nearcarta.near', amount: '1', nonce: '0' });
  assert.equal(msg, 'board-v1|charters.nearcarta.near|alice.near|shop.nearcarta.near|1|0');
  assert.equal(shopMessage({ contract: 'charters.nearcarta.near', owner: 'alice.near', receiver: 'shop.nearcarta.near', amount: '1', nonce: '0' }), msg);
});

test('the board deploy script prints the exact cost and does not sign', () => {
  const script = fileURLToPath(new URL('../../../backend/scripts/deploy-mainnet-board.js', import.meta.url));
  const dry = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  const cost = deployCost(wasm.length, MAIN.root);
  assert.match(dry.stdout, new RegExp('Total: ' + cost.totalYocto.toString() + ' yoctoNEAR'));
  assert.match(dry.stdout, new RegExp('Storage stake: ' + cost.stakeYocto.toString() + ' yoctoNEAR'));
  assert.match(dry.stdout, /does not sign/);
  assert.match(dry.stdout, /sha256 [0-9a-f]{64}/);
  assert.equal(dry.stdout.match(/sha256 ([0-9a-f]{64})/)[1], createHash('sha256').update(wasm).digest('hex'));
  assert.doesNotMatch(dry.stdout + dry.stderr, /ed25519:[1-9A-HJ-NP-Za-km-z]{20}/);
  const live = spawnSync(process.execPath, [script, '--live'], { encoding: 'utf8', env: { ...process.env, NEAR_MAINNET_SIGNER_KEY: '' } });
  assert.notEqual(live.status, 0);
  assert.match(live.stderr, /NEAR_MAINNET_SIGNER_KEY/);
  assert.doesNotMatch(live.stdout + live.stderr, /ed25519:[1-9A-HJ-NP-Za-km-z]{20}/);
});

test('the public mainnet flag opens a row only after the board is deployed', () => {
  const off = setupJourney(true, { publicMainnet: true, boardDeployed: false });
  assert.equal(off.createCharter, false);
  assert.equal(off.showGuest, false);
  assert.doesNotMatch(off.fundLead, otherNet);
  const on = setupJourney(false, { publicMainnet: true, boardDeployed: true });
  assert.equal(on.createCharter, true);
  assert.equal(on.badge, 'mainnet');
  assert.equal(on.showGuest, false);
});
