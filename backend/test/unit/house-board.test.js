import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  injectRowOwner, proposeCallAs, callAsText, confirmText, cancelHoldArgs, expireSentArgs, effectTokenOk, CALL_AS_METHODS,
} from '../../../app/src/house-board.js';
import { sha256Hex } from '../../../app/src/sha256.js';
import { planHouseLine } from '../../../app/src/panels/house-agent.js';
import { planSuccessor } from '../../../scripts/house-deploy.js';
import { recoveryPlan, sourceMethods, wasmExports } from '../../../scripts/house-recover.js';
import { HOUSE_CALLS, HOUSE_LEGACY, HOUSE_SHOP } from '../../../shared/house/shop.js';
import { FERRY_CALL_TARGETS, MAX_CALLS, callPolicy } from '../../../shared/board/session.js';
import { shopOf } from '../../../backend/src/board-tx.js';
import { isDenied } from '../../../backend/src/vault.js';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };

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

test('the successor plan funds the new shop from the owner', () => {
  const plan = planSuccessor({
    shop: HOUSE_SHOP,
    owner: 'nearcarta.near',
    legacy: HOUSE_LEGACY,
    wasmBytes: 373051,
    wasmSha256: 'abc',
    ownerBalanceYocto: '1000000000000000000000000',
    shopExists: false,
  });
  assert.equal(plan.transfers.length, 1);
  assert.equal(plan.transfer.from, 'nearcarta.near');
  assert.equal(plan.transfer.payee, HOUSE_SHOP);
  assert.notEqual(plan.transfer.payee, HOUSE_LEGACY);
  assert.equal(plan.transfer.amountYocto, plan.stakeYocto);
  assert.equal(plan.liveReady, false);
  assert.equal(plan.coveredNow, false);
  assert.equal(plan.shopExists, false);
  const funded = planSuccessor({ ...{
    shop: HOUSE_SHOP, owner: 'nearcarta.near', legacy: HOUSE_LEGACY, wasmBytes: 373051, wasmSha256: 'abc', shopExists: false,
  }, ownerBalanceYocto: plan.peakYocto });
  assert.equal(funded.coveredNow, true);
  assert.equal(funded.liveReady, true);
  const taken = planSuccessor({
    shop: HOUSE_SHOP, owner: 'nearcarta.near', legacy: HOUSE_LEGACY, wasmBytes: 373051, wasmSha256: 'abc',
    ownerBalanceYocto: plan.peakYocto, shopExists: true,
  });
  assert.equal(taken.liveReady, false);
  const src = readFileSync(new URL('../../../contracts/house_nft/src/lib.rs', import.meta.url), 'utf8');
  assert.match(src, /fn migrate_from_v2/);
  assert.match(src, /only the contract may migrate/);
  assert.match(src, /top-level argument the board writes/);
});

test('the legacy wasm recovers by house_pay and then close', () => {
  const exports = wasmExports(Buffer.from('AGFzbQEAAAABBAFgAAADBAMAAAAHIQMFY2xvc2UAAAlob3VzZV9wYXkAAQluZnRfdG9rZW4AAgoNAwMAAQsDAAELAwABCw==', 'base64'));
  assert.deepEqual(exports, ['close', 'house_pay', 'nft_token']);
  const plan = recoveryPlan({
    exports: ['nft_token', 'house_pay', 'house_fund', 'close', 'house_held'],
    purseYocto: '1000000000000000000000',
    heldYocto: '1000000000000000000000',
    holder: 'nearcarta.near',
    owner: 'nearcarta.near',
    shop: HOUSE_LEGACY,
  });
  assert.equal(plan.locked, false);
  assert.equal(plan.steps[0].method, 'house_pay');
  assert.equal(plan.steps[0].signer, 'nearcarta.near');
  assert.equal(plan.steps[0].args.amount, '1000000000000000000000');
  assert.equal(plan.steps[0].args.receiver_id, 'nearcarta.near');
  assert.equal(plan.steps[1].method, 'close');
  assert.equal(plan.absent.includes('upgrade'), true);
  assert.equal(plan.absent.includes('migrate'), true);
  assert.equal(plan.absent.includes('house_withdraw'), true);
  const locked = recoveryPlan({
    exports: ['nft_token', 'house_fund'], purseYocto: '1', heldYocto: '1', holder: 'nearcarta.near', owner: 'nearcarta.near', shop: HOUSE_LEGACY,
  });
  assert.equal(locked.locked, true);
  assert.match(locked.why, /stays on the shop/);
  const src = sourceMethods('impl Contract { pub fn house_pay(&self) {} pub fn close(&mut self) {} }');
  assert.deepEqual(src, ['house_pay', 'close']);
});

test('the city, the allow list and the denylist use the one shop id', () => {
  assert.equal(HOUSE_LEGACY, 'house.nearcarta.near');
  assert.equal(MAIN.extras.house.contract, HOUSE_LEGACY);
  assert.equal(MAIN.extras.house.shop.status, 'not_deployed');
  assert.equal(MAIN.extras.house.shop.account, HOUSE_SHOP);
  assert.notEqual(HOUSE_SHOP, HOUSE_LEGACY);
  assert.equal(shopOf(HOUSE_SHOP), 'house');
  assert.equal(shopOf(HOUSE_LEGACY), 'house');
  assert.equal(isDenied(HOUSE_SHOP), true);
  assert.equal(isDenied(HOUSE_LEGACY), true);
  const policy = callPolicy(
    [MAIN.charter.contract, MAIN.toll.contract, HOUSE_SHOP],
    '1', '1', 'ft_transfer', [...FERRY_CALL_TARGETS, ...HOUSE_CALLS],
  );
  assert.ok(policy.calls.length <= MAX_CALLS);
  assert.equal(policy.calls.some(row => row.receiver === HOUSE_SHOP && row.method === 'house_session_check_in'), true);
  assert.equal(policy.calls.some(row => row.receiver === HOUSE_SHOP && row.method === 'house_session_prepare_send'), true);
  const setup = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
  assert.match(setup, /HOUSE_SHOP/);
  assert.doesNotMatch(setup, /house3\.nearcarta\.near/);
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
  assert.match(readme, /extras\.house\.shop/);
  assert.match(readme, /legacy shop/);
  assert.doesNotMatch(readme, /house3\.nearcarta\.near/);
});
