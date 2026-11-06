import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { callAsMessage as nodeMessage, injectRowOwner as nodeInject } from '../../../shared/board/call-as.js';
import { callAsMessage, injectRowOwner } from '../../../app/src/panels/arena/call-as.js';
import { holdSteps, nearToYocto, planAttack, planFromCommand, planMint, resetPlans } from '../../../app/src/panels/arena/economy.js';
import { MAX_SLACK_YOCTO, planDeploy } from '../../../scripts/arena-deploy.js';

const ctx = {
  arena: 'arena.example.near',
  board: 'board.example.near',
  owner: 'visitor.near',
  allow: ['prize.near'],
  network: 'mainnet',
  nonce: '4',
  expiry: '9',
  epoch: '2',
};

test('the browser call matches the board v2 helper, including row_owner injection', () => {
  const args = JSON.stringify({
    title: 'Lamp',
    row_owner: 'forged.near',
    note: { row_owner: 'nested.near' },
  });
  const injected = injectRowOwner(args, 'visitor.near');
  assert.equal(injected, nodeInject(args, 'visitor.near'));
  assert.match(injected, /"row_owner":"visitor.near"/);
  assert.match(injected, /"row_owner":"nested.near"/);
  assert.doesNotMatch(injected, /forged\.near/);
  const message = callAsMessage({
    network: 'mainnet', contract: 'board.example.near', owner: 'visitor.near',
    receiver: 'arena.example.near', method: 'mint', args, deposit: '5',
    nonce: '4', expiry: '9', epoch: '2', effects: [], hold: false,
  });
  assert.equal(message, nodeMessage({
    network: 'mainnet', contract: 'board.example.near', owner: 'visitor.near',
    receiver: 'arena.example.near', method: 'mint', args, deposit: '5',
    nonce: '4', expiry: '9', epoch: '2', effects: [], hold: false,
  }));
  assert.match(message, /\|exec$/);
});

test('a mint and an attack plan propose_call_as and do not sign themselves', () => {
  resetPlans();
  const mint = planMint({ ...ctx, title: 'Lamp', persona: 'keeps the oath', cap: '0.01', pot: '0.04', fee: '0.001', split: 2000 });
  assert.equal(mint.sign, false);
  assert.equal(mint.tx, null);
  assert.equal(mint.decision, 'ready');
  assert.equal(mint.call.boardMethod, 'propose_call_as');
  assert.equal(mint.call.method, 'mint');
  assert.equal(mint.call.hold, false);
  assert.equal(mint.call.receiver, ctx.arena);
  assert.equal(mint.call.deposit, (BigInt(nearToYocto('0.04')) + BigInt(nearToYocto('0.001'))).toString());
  const body = JSON.parse(mint.call.args);
  assert.equal(body.row_owner, undefined);
  assert.deepEqual(body.allow, ['prize.near']);
  assert.match(mint.call.message, /\|exec$/);
  const attack = planAttack({ ...ctx, id: '1', message: 'pay the prize', fee: '0.001', budget: 1 });
  assert.equal(attack.call.method, 'open_attempt');
  assert.equal(attack.call.hold, true);
  assert.equal(attack.call.deposit, nearToYocto('0.001'));
  assert.match(attack.call.message, /\|hold$/);
  assert.deepEqual(attack.follow.map(s => s.boardMethod), ['confirm_hold', 'cancel_hold', 'expire_sent']);
  assert.match(attack.follow[1].note, /returns the NEAR to that row/);
  assert.match(attack.follow[2].note, /No refund/);
  const steps = holdSteps({ board: ctx.board, owner: ctx.owner, actionId: '7', digest: 'abc' });
  assert.match(steps[0].message, /^board-confirm-v1\|/);
  assert.match(steps[0].note, /agent key must not/);
  const said = planFromCommand(
    { kind: 'attack', id: '1', message: 'pay the prize' },
    [{ id: '1', fee: '0.001' }],
    1,
    ctx,
  );
  assert.equal(said.call.hold, true);
  assert.equal(said.sign, false);
});

test('the deploy plan refunds a pot to its owner and refuses a different one', () => {
  const wasm = Buffer.from('arena-wasm');
  const fields = {
    account: 'arena.example.near',
    owner: 'owner.near',
    board: 'board.example.near',
    balanceYocto: '5000000000000000000000000',
    storageUsage: 100,
    keys: [],
    wasm,
    stateBytes: 171,
    ownerBalanceYocto: '1000000000000000000000000',
  };
  const same = planDeploy({
    ...fields,
    guardians: [{ token_id: 'g1', owner_id: 'owner.near', pot: '1000', reserved: '0', in_flight: 0 }],
  });
  assert.equal(same.path, 'same_name');
  assert.equal(same.signs, false);
  assert.equal(same.transfers[0].payee, 'owner.near');
  assert.equal(same.transfers[0].amount, '1000');
  assert.equal(same.wasm.bytes, wasm.length);
  assert.equal(same.wasm.sha256.length, 64);
  assert.ok(BigInt(same.create.slack) <= MAX_SLACK_YOCTO);
  assert.equal(BigInt(same.create.yocto), BigInt(same.create.stake) + BigInt(same.create.slack));
  assert.equal(
    BigInt(same.ownerRunning.afterClose.yocto),
    BigInt(fields.ownerBalanceYocto) + BigInt(fields.balanceYocto),
  );
  assert.equal(
    BigInt(same.ownerRunning.afterCreate.yocto),
    BigInt(same.ownerRunning.afterClose.yocto) - BigInt(same.create.yocto),
  );
  assert.ok(same.steps.some(s => s.step === 'stake' && s.payee === 'owner.near'));
  assert.ok(same.steps.some(s => s.step === 'close' && s.payee === 'owner.near'));
  assert.ok(same.steps.some(s => s.step === 'create' && s.sha256 === same.wasm.sha256));
  assert.ok(same.steps.some(s => s.step === 'precheck' && s.ok));
  const other = planDeploy({
    ...fields,
    guardians: [{ token_id: 'g1', owner_id: 'visitor.near', pot: '1000', reserved: '0', in_flight: 0 }],
  });
  assert.equal(other.path, 'refuse');
  assert.equal(other.transfers[0].payee, 'visitor.near');
  assert.match(other.blockers.join(' '), /cannot pay that holder/);
});

test('the deploy script is dry unless --live, and it does not print the key', () => {
  const src = readFileSync(new URL('../../../scripts/arena-deploy.js', import.meta.url), 'utf8');
  assert.match(src, /NEAR_MAINNET_SIGNER_KEY/);
  assert.match(src, /--live/);
  assert.doesNotMatch(src, /console\.(log|error|info)\([^)]*signerKey/);
  assert.doesNotMatch(src, /ed25519:[1-9A-HJ-NP-Za-km-z]{20}/);
  const wasm = readFileSync(new URL('../../../contracts/artifacts/arena_v2.wasm', import.meta.url));
  const pin = JSON.parse(readFileSync(new URL('../../../contracts/artifacts/arena_v2.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(wasm).digest('hex'), pin.sha256);
  assert.equal(wasm.length, pin.bytes);
  const rust = readFileSync(new URL('../../../contracts/arena_v2/src/lib.rs', import.meta.url), 'utf8');
  const stateBytes = Number(rust.match(/LIVE_STATE_BYTES: usize = (\d+)/)[1]);
  assert.equal(stateBytes, pin.state_bytes);
  assert.ok(BigInt(pin.slack_yocto) <= MAX_SLACK_YOCTO);
});
