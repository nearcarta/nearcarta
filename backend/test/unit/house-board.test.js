import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  injectRowOwner, proposeCallAs, callAsText, confirmText, cancelHoldArgs, expireSentArgs, effectTokenOk, CALL_AS_METHODS,
} from '../../../app/src/house-board.js';
import { sha256Hex } from '../../../app/src/sha256.js';
import { planHouseLine } from '../../../app/src/panels/house-agent.js';
import { planDeploy } from '../../../scripts/house-deploy.js';

test('sha256 matches node', () => {
  assert.equal(sha256Hex('abc'), createHash('sha256').update('abc').digest('hex'));
});

test('the board replaces a top-level row_owner and leaves a nested one', () => {
  const args = '{"amount":"1","note":{"row_owner":"mallory.near"}}';
  const out = injectRowOwner(args, 'alice.near');
  assert.equal(out, '{"amount":"1","note":{"row_owner":"mallory.near"},"row_owner":"alice.near"}');
  const forged = injectRowOwner('{"token_id":"alice.near","row_owner":"mallory.near"}', 'alice.near');
  assert.equal(JSON.parse(forged).row_owner, 'alice.near');
  assert.equal(JSON.parse(forged).token_id, 'alice.near');
});

test('propose_call_as uses the v2 method, args, and hold flow', () => {
  const call = proposeCallAs({
    network: 'mainnet',
    board: 'board.nearcarta.near',
    owner: 'alice.near',
    receiver: 'house.nearcarta.near',
    method: 'house_session_check_in',
    args: { token_id: 'alice.near' },
    deposit: '1',
    expiry: '60',
    nonce: '4',
    epoch: '0',
    effects: [],
    hold: false,
  });
  assert.equal(call.method, 'propose_call_as');
  assert.deepEqual(Object.keys(call.args), ['owner', 'receiver', 'method', 'args', 'deposit', 'expiry', 'effects', 'hold', 'signature']);
  assert.equal(call.args.signature, '');
  assert.equal(call.args.hold, false);
  assert.equal(call.signed, false);
  assert.equal(call.argsOut, '{"token_id":"alice.near","row_owner":"alice.near"}');
  const text = callAsText({
    network: 'mainnet', board: 'board.nearcarta.near', owner: 'alice.near', receiver: 'house.nearcarta.near',
    method: 'house_session_check_in', argsOut: call.argsOut, deposit: '1', nonce: '4', expiry: '60', epoch: '0',
    effects: [], hold: false,
  });
  assert.equal(call.message, text);
  assert.match(text, /^board-call-as-v1\|mainnet\|board\.nearcarta\.near\|2\|alice\.near\|house\.nearcarta\.near\|house_session_check_in\|/);
  assert.match(text, /\|-\|exec$/);
  assert.match(text, /\|exec$/);
  const held = proposeCallAs({
    network: 'mainnet', board: 'board.nearcarta.near', owner: 'alice.near', receiver: 'house.nearcarta.near',
    method: 'house_session_prepare_send',
    args: { token_id: 'alice.near', chain: 'base', to: '0xabc', asset: 'ETH', value: '1', gas_limit: 21000, action_id: 'a' },
    deposit: '1', expiry: '60', nonce: '5', epoch: '1',
    effects: [{ chain: 'base', asset: 'ETH', to: '0xabc', value: '1', fee: '0' }],
    hold: true,
  });
  assert.equal(held.args.hold, true);
  assert.match(held.message, /\|base\|ETH\|0xabc\|1\|0\|hold$/);
  assert.deepEqual(CALL_AS_METHODS, ['propose_call_as', 'confirm_hold', 'cancel_hold', 'expire_sent']);
  assert.deepEqual(Object.keys(cancelHoldArgs('9').args), ['action_id']);
  assert.deepEqual(Object.keys(expireSentArgs('alice.near', '9').args), ['owner', 'action_id']);
  const confirm = confirmText({
    board: 'board.nearcarta.near', owner: 'alice.near', actionId: '9',
    method: 'house_session_check_in', args: call.argsOut, deposit: '1', effects: [],
  });
  assert.match(confirm, /^board-confirm-v1\|board\.nearcarta\.near\|alice\.near\|9\|[0-9a-f]{64}\|present$/);
  assert.equal(effectTokenOk('0xabc'), true);
  assert.equal(effectTokenOk('x'.repeat(65)), false);
  assert.throws(() => proposeCallAs({
    network: 'mainnet', board: 'board.nearcarta.near', owner: 'alice.near', receiver: 'house.nearcarta.near',
    method: 'house_session_prepare_send', args: {}, deposit: '1', expiry: '1', nonce: '1', epoch: '0',
    effects: [{ chain: 'base', asset: 'ETH', to: 'not a payee', value: '1', fee: '0' }], hold: true,
  }), /ERR_EFFECT/);
});

test('a visitor check-in builds propose_call_as from that visitor\'s row', () => {
  const visitor = 'bob.near';
  const house = 'house.nearcarta.near';
  const plan = planHouseLine("I'm alive", {
    account: visitor,
    house,
    tokenId: visitor,
    board: 'board.nearcarta.near',
    network: 'mainnet',
    nonce: '2',
    epoch: '0',
    row: {
      receivers: [house],
      per_action_cap: '1000',
      min_amount: '1',
      balance: '50',
      frozen: false,
    },
  });
  assert.equal(plan.action, 'checkin');
  assert.equal(plan.label, 'planned');
  assert.equal(plan.signed, false);
  assert.equal(plan.call.method, 'propose_call_as');
  assert.equal(plan.call.args.owner, visitor);
  assert.equal(plan.call.args.receiver, house);
  assert.equal(plan.call.args.method, 'house_session_check_in');
  assert.equal(plan.call.args.deposit, '1');
  assert.equal(plan.call.args.hold, false);
  assert.equal(JSON.parse(plan.call.args.args).row_owner, undefined);
  assert.equal(JSON.parse(plan.call.argsOut).row_owner, visitor);
  const missing = planHouseLine("I'm alive");
  assert.equal(missing.label, 'blocked');
  assert.equal(missing.signed, false);
});

test('the deploy plan refunds the holder and funds only the shop', () => {
  const plan = planDeploy({
    shop: 'house.nearcarta.near',
    owner: 'nearcarta.near',
    wasmBytes: 370200,
    wasmSha256: 'abc',
    oldCodeBytes: 245996,
    storageUsage: 247204,
    balanceYocto: '2502774762262500000000000',
    fullAccessKeys: 0,
    codeHash: '8amkMEcCFxQHbHkgZqP72LXJnoJ1iecGq6B71gPiNMXK',
    recordedHash: '8amkMEcCFxQHbHkgZqP72LXJnoJ1iecGq6B71gPiNMXK',
    purses: [{ tokenId: 'visitor.near', owner: 'visitor.near', balanceYocto: '1000000000000000000000' }],
  });
  assert.equal(plan.refunds.length, 1);
  assert.equal(plan.refunds[0].payee, 'visitor.near');
  assert.equal(plan.refunds[0].amountYocto, '1000000000000000000000');
  assert.equal(plan.transfers.length, 1);
  assert.equal(plan.transfers[0].from, 'nearcarta.near');
  assert.equal(plan.transfers[0].payee, 'house.nearcarta.near');
  assert.equal(plan.liveReady, false);
  assert.ok(BigInt(plan.stakeYocto) > BigInt(plan.balanceBeforeYocto));
  const src = readFileSync(new URL('../../../contracts/house_nft/src/lib.rs', import.meta.url), 'utf8');
  assert.match(src, /fn migrate_from_v2/);
  assert.match(src, /only the contract may migrate/);
  assert.match(src, /top-level argument the board writes/);
});
