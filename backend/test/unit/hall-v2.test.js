import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { callAsMessage, injectRowOwner } from '../../../shared/board/call-as.js';
import { BOARD_METHODS, holdFlow, proposeCallAs, stampCall } from '../../../shared/hall/v2.js';
import { hallDeployPlan } from '../../../shared/hall/deploy-plan.js';

test('board v2 injects row_owner and the hold flow uses propose_call_as, stamp, confirm, cancel, expire_sent', () => {
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
  assert.equal(flow.confirmText, 'board-confirm-v1|board.nearcarta.near|alice.near|7|cd|present');
  assert.deepEqual(BOARD_METHODS, ['propose_call_as', 'confirm_hold', 'cancel_hold', 'expire_sent', 'stamp']);
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
