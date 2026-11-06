import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { callAsMessage, injectRowOwner } from '../../../shared/board/call-as.js';
import { BOARD_METHODS, holdFlow, proposeCallAs, stampCall } from '../../../shared/hall/v2.js';
import { hallDeployPlan, MIGRATE_ATTACHED_YOCTO } from '../../../shared/hall/deploy-plan.js';

test('board v2 injects row_owner and the hold flow uses propose_call_as, stamp, confirm, cancel, expire_sent, settle, refund_action', () => {
  const raw = JSON.stringify({ task: 'readme', note: { row_owner: 'mallory.near' }, row_owner: 'mallory.near' });
  const injected = injectRowOwner(raw, 'alice.near');
  const parsed = JSON.parse(injected);
  assert.equal(parsed.row_owner, 'alice.near');
  assert.equal(parsed.note.row_owner, 'mallory.near');
  const hash = createHash('sha256').update(injected).digest('hex');
  const msg = callAsMessage({
    network: 'mainnet', contract: 'board.nearcarta.near', owner: 'alice.near',
    receiver: 'townhall.nearcarta.near', method: 'post_job', args: raw,
    deposit: '1000', nonce: '0', expiry: '99', epoch: '0', effects: [], hold: true,
  });
  assert.equal(msg, `board-call-as-v1|mainnet|board.nearcarta.near|2|alice.near|townhall.nearcarta.near|post_job|${hash}|1000|0|99|0|-|hold`);
  const flow = holdFlow({
    network: 'mainnet', contract: 'board.nearcarta.near', owner: 'alice.near',
    receiver: 'townhall.nearcarta.near', method: 'post_job', args: raw,
    deposit: '1000', nonce: '0', expiry: '99', epoch: '0', effects: [],
    actionId: '7', confirmSignature: 'ab', digest: 'cd',
  });
  assert.equal(flow.propose.method, 'propose_call_as');
  assert.equal(flow.propose.args.hold, true);
  assert.deepEqual(Object.keys(flow.propose.args), ['owner', 'receiver', 'method', 'args', 'deposit', 'expiry', 'effects', 'hold', 'signature']);
  assert.equal(JSON.parse(flow.injected).row_owner, 'alice.near');
  assert.deepEqual(flow.confirm, { method: 'confirm_hold', args: { owner: 'alice.near', action_id: '7', signature: 'ab' } });
  assert.deepEqual(flow.cancel, { method: 'cancel_hold', args: { action_id: '7' } });
  assert.deepEqual(flow.expire, { method: 'expire_sent', args: { owner: 'alice.near', action_id: '7' } });
  assert.deepEqual(flow.settle, { method: 'settle', args: { owner: 'alice.near', action_id: '7' } });
  assert.deepEqual(flow.refund, { method: 'refund_action', args: { owner: 'alice.near', action_id: '7' }, deposit: '1000' });
  assert.equal(flow.confirmText, 'board-confirm-v1|board.nearcarta.near|alice.near|7|cd|present');
  assert.deepEqual(BOARD_METHODS, ['propose_call_as', 'confirm_hold', 'cancel_hold', 'expire_sent', 'settle', 'refund_action', 'stamp']);
  assert.deepEqual(stampCall({ owner: 'alice.near' }), { method: 'stamp', receiverIsBoard: true, args: { owner: 'alice.near' } });
  const sent = proposeCallAs({
    owner: 'bob.near', receiver: 'shop.near', method: 'bid', args: { job_id: '1' },
    deposit: '0', expiry: '5', effects: [{ chain: 'near', asset: 'NEAR', to: 'bob.near', value: '1', fee: '0' }],
    hold: false, signature: 'sig',
  });
  assert.equal(sent.args.hold, false);
  assert.equal(sent.args.receiver, 'shop.near');
});

test('an open bounty refunds the posting signer and a stranger is refused', () => {
  const base = {
    shop: 'shop.near', owner: 'dao.near', board: 'board.near', dao: 'dao.near',
    balanceYocto: (3n * 10n ** 24n).toString(),
    storageBytes: 1000, oldWasmBytes: 800, newWasmBytes: 800, wasmSha256: 'ab',
    bounties: [
      { hash: 'aa', amount: '2000000000000000000000', claimed_by: null },
      { hash: 'bb', amount: '1000000000000000000000', claimed_by: 'paid.near' },
    ],
    posts: [{ method: 'post_bounty', bountyHash: 'aa', amount: '2000000000000000000000', receiver: 'shop.near', signer: 'dao.near', tx: 'TX' }],
    fullAccessKeys: 1, codeHash: 'old', oldCodeHash: 'old', smokeWorkers: ['w1.near', 'w2.near'],
    guard: 'guard.near', guardCodeHash: 'G', guardExpectedCodeHash: 'G',
  };
  const plan = hallDeployPlan(base);
  assert.equal(plan.transfers.length, 1);
  assert.equal(plan.transfers[0].payee, 'dao.near');
  assert.equal(plan.transfers[0].amount, '2000000000000000000000');
  assert.equal(plan.ok, true);
  assert.equal(plan.steps[0].n, 1);
  assert.equal(plan.steps[3].calls[0].args.workers[0], 'w1.near');
  assert.throws(() => hallDeployPlan({
    ...base,
    posts: [{ ...base.posts[0], signer: 'stranger.near' }],
  }), /not the dao or the shop/);
});

test('the live townhall plan names the real shortfall and covers the attached migrate gas', () => {
  const live = {
    shop: 'townhall.nearcarta.near', owner: 'nearcarta.near', board: 'board.nearcarta.near', dao: 'nearcarta.near',
    balanceYocto: (19532653634875n * 10n ** 11n).toString(),
    storageBytes: 192231, oldWasmBytes: 191351, newWasmBytes: 229717, wasmSha256: 'ab',
    bounties: [{ hash: 'h', amount: '2000000000000000000000', claimed_by: null }],
    posts: [{ method: 'post_bounty', bountyHash: 'h', amount: '2000000000000000000000', receiver: 'townhall.nearcarta.near', signer: 'nearcarta.near', tx: 'T' }],
    fullAccessKeys: 1, codeHash: 'c', oldCodeHash: 'c', smokeWorkers: [],
    guard: 'guard.near', guardCodeHash: 'G', guardExpectedCodeHash: 'G',
  };
  const plan = hallDeployPlan(live);
  // The 30 Tgas attached to migrate is prepaid at 0.001 NEAR/Tgas on top of the fee gas.
  assert.ok(BigInt(plan.balance.prepaidDeploy) >= BigInt(MIGRATE_ATTACHED_YOCTO));
  // The account must hold the new stake plus that prepaid float at the moment the
  // deploy writes storage; the unused gas comes back only after the receipt. The
  // exact figure tracks the committed wasm, so assert its arithmetic, not a constant.
  const stake = BigInt(plan.storage.stakeAfter);
  const need = stake + BigInt(plan.balance.prepaidDeploy);
  const have = BigInt(live.balanceYocto) - BigInt(plan.balance.refund);
  assert.equal(BigInt(plan.balance.shortfall), need - have);
  assert.ok(BigInt(plan.balance.shortfall) > 0n);
  // The printed top-up adds the smoke reserve and rounds up to the next 0.05 NEAR.
  const STEP = 5n * 10n ** 22n;
  const reserve = 3n * 10n ** 22n + 10n ** 21n; // smoke gas + smoke deposit
  const rounded = ((need - have + reserve + STEP - 1n) / STEP) * STEP;
  assert.equal(plan.balance.recommendedTopUp, rounded.toString());
  assert.equal(plan.balance.recommendedTopUp, '450000000000000000000000');
  assert.ok(BigInt(plan.balance.recommendedTopUp) > BigInt(plan.balance.shortfall));
  assert.equal(plan.ok, false); // nothing is signed until the top-up lands
  // Adding the rounded top-up clears the shortfall and the plan becomes actionable.
  const topped = hallDeployPlan({ ...live, balanceYocto: (BigInt(live.balanceYocto) + BigInt(plan.balance.recommendedTopUp)).toString() });
  assert.equal(topped.balance.shortfall, '0');
  assert.equal(topped.ok, true);
  assert.deepEqual(topped.transfers.map(t => t.payee), ['nearcarta.near']);
});

test('the deploy refuses when the board is not the v2 wasm the contract trusts', () => {
  const base = {
    shop: 'townhall.nearcarta.near', owner: 'nearcarta.near', board: 'board.nearcarta.near', dao: 'nearcarta.near',
    balanceYocto: (3n * 10n ** 24n).toString(),
    storageBytes: 192231, oldWasmBytes: 191351, newWasmBytes: 215902, wasmSha256: 'ab',
    bounties: [], posts: [], fullAccessKeys: 1, codeHash: 'c', oldCodeHash: 'c', smokeWorkers: [],
    boardCodeHash: 'BF1rQSrGWMdY5FCizTpSe1qi1JTdYeY786ny8qdpVg4g',
    boardExpectedCodeHash: 'BF1rQSrGWMdY5FCizTpSe1qi1JTdYeY786ny8qdpVg4g',
    guard: 'guard.near', guardCodeHash: 'G', guardExpectedCodeHash: 'G',
  };
  const ok = hallDeployPlan(base);
  assert.equal(ok.checks.find(c => /v2 wasm/.test(c.label)).ok, true);
  assert.equal(ok.ok, true);
  // A board on any other code hash leaves row_owner untrusted, so nothing may deploy.
  const stale = hallDeployPlan({ ...base, boardCodeHash: 'Am4FLfphc4JF7ZZLRrs3j1otwyKyiQZqygBJ8nnZs78C' });
  assert.equal(stale.checks.find(c => /v2 wasm/.test(c.label)).ok, false);
  assert.equal(stale.ok, false);
  // An unreadable board is the same refusal, not a pass.
  const missing = hallDeployPlan({ ...base, boardCodeHash: '' });
  assert.equal(missing.ok, false);
});

test('the plan snapshots every legacy bounty and refuses a guard that is not the live one', () => {
  const base = {
    shop: 'shop.near', owner: 'dao.near', board: 'board.near', dao: 'dao.near',
    balanceYocto: (3n * 10n ** 24n).toString(),
    storageBytes: 1000, oldWasmBytes: 800, newWasmBytes: 800, wasmSha256: 'ab',
    bounties: [
      { hash: 'aa', amount: '2000000000000000000000', claimed_by: null },
      { hash: 'bb', amount: '1000000000000000000000', claimed_by: 'paid.near' },
    ],
    posts: [{ method: 'post_bounty', bountyHash: 'aa', amount: '2000000000000000000000', receiver: 'shop.near', signer: 'dao.near', tx: 'TX' }],
    fullAccessKeys: 1, codeHash: 'old', oldCodeHash: 'old', smokeWorkers: [],
    guard: 'guard.near', guardCodeHash: 'G', guardExpectedCodeHash: 'G',
  };
  const plan = hallDeployPlan(base);
  // Both bounties appear, owed and paid, so a reader can audit the migration.
  assert.equal(plan.legacy.rows.length, 2);
  assert.deepEqual(plan.legacy.rows.map(r => r.status), ['refund_now', 'already_paid']);
  assert.equal(plan.legacy.owedYocto, '2000000000000000000000');
  assert.equal(plan.legacy.paidYocto, '1000000000000000000000');
  // The migrate arg carries the snapshot, so the new state proves what was paid.
  assert.equal(plan.steps[1].args.legacy_paid.length, 2);
  assert.match(plan.steps[1].args.legacy_paid[0], /^aa:refund_now:2000000000000000000000:dao\.near$/);
  assert.match(plan.steps[1].args.legacy_paid[1], /^bb:already_paid:1000000000000000000000:paid\.near$/);
  assert.equal(plan.steps[1].args.guard, 'guard.near');

  // A guard on another wasm would leave every release path dead.
  const staleGuard = hallDeployPlan({ ...base, guardCodeHash: 'other' });
  assert.equal(staleGuard.checks.find(c => /guard account is the wasm/.test(c.label)).ok, false);
  assert.equal(staleGuard.ok, false);
  // No guard named at all is the same refusal, not a pass.
  assert.equal(hallDeployPlan({ ...base, guard: '' }).ok, false);
  // The shop and the board cannot be their own guard.
  assert.equal(hallDeployPlan({ ...base, guard: 'shop.near' }).ok, false);
});
