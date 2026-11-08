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
  // Minting is the shop owner's own `mint_guardian`, which the arena contract restricts to its
  // owner. Measured on mainnet 2026-11-08: the page used to propose_call_as a method named `mint`,
  // which no arena wasm has (MethodResolveError before any deposit moved), and the row did not
  // allow it either (method_not_allowlisted). The honest result is a refusal that names the
  // reason, not a call the chain cannot answer.
  const mint = planMint({ ...ctx, title: 'Lamp', persona: 'keeps the oath', cap: '0.01', pot: '0.04', fee: '0.001', split: 2000 });
  assert.equal(mint.sign, false);
  assert.equal(mint.tx, null);
  assert.equal(mint.decision, 'blocked');
  assert.equal(mint.call, undefined, 'no propose_call_as is built for a method the shop does not have');
  assert.match(mint.reason, /owner/i);
  assert.match(mint.reason, /mint_guardian/);
  // The arena has no `open_attempt` either (MethodNotFound on the deployed contract, 2026-11-08).
  // Its real attempt path is `attempt` + `agent_act`, and both take the PLAYER as predecessor, so
  // a row cannot make them. The plan refuses with that reason instead of proposing a method the
  // contract does not have.
  const attack = planAttack({ ...ctx, id: '1', message: 'pay the prize', fee: '0.001', budget: 1 });
  assert.equal(attack.sign, false);
  assert.equal(attack.decision, 'blocked');
  assert.equal(attack.call, undefined, 'no propose_call_as for a method only the player may call');
  assert.match(attack.reason, /attempt/);
  assert.match(attack.reason, /player/i);
  // `follow` (confirm/cancel/expire the hold) belonged to the plan that opened an attempt. With
  // no attempt proposed there is no hold to follow, so those steps are gone with it. The hold
  // steps themselves are still covered below by holdSteps().
  const steps = holdSteps({ board: ctx.board, owner: ctx.owner, actionId: '7', digest: 'abc' });
  assert.match(steps[0].message, /^board-confirm-v1\|/);
  assert.match(steps[0].note, /agent key must not/);
  const said = planFromCommand(
    { kind: 'attack', id: '1', message: 'pay the prize' },
    [{ id: '1', fee: '0.001' }],
    1,
    ctx,
  );
  // The same rule applies when the sentence comes through the dock: no call, an honest reason.
  assert.equal(said.call, undefined, 'a typed attack is refused the same way as the button');
  assert.equal(said.sign, false);
  assert.match(said.reason, /player/i);
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
