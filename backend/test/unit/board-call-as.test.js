import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callAsMessage, confirmMessage, injectRowOwner } from '../../../shared/board/call-as.js';
import * as shared from '../../../shared/board/call-as.js';
import * as browser from '../../../app/src/board-call-as.js';

test('the call-as envelope matches the contract fixture', () => {
  const args = '{"amount":"1","note":{"row_owner":"mallory.near"}}';
  assert.equal(injectRowOwner(args, 'alice.near'), '{"amount":"1","note":{"row_owner":"mallory.near"},"row_owner":"alice.near"}');
  assert.equal(callAsMessage({
    network: 'mainnet',
    contract: 'charters.nearcarta.near',
    owner: 'alice.near',
    receiver: 'shop.nearcarta.near',
    method: 'ft_transfer',
    args,
    deposit: '1',
    nonce: '0',
    expiry: '99',
    epoch: '0',
    effects: [],
    hold: false,
  }), 'board-call-as-v1|mainnet|charters.nearcarta.near|2|alice.near|shop.nearcarta.near|ft_transfer|b99351d51b134e460c661fda6f7bfedf1ed9ba92d887028a142a14469a2308f3|1|0|99|0|-|exec');
  assert.equal(confirmMessage({
    contract: 'board.nearcarta.near', owner: 'alice.near', actionId: '4', digest: 'ab'.repeat(32),
  }), `board-confirm-v1|board.nearcarta.near|alice.near|4|${'ab'.repeat(32)}|present`);
  assert.throws(() => injectRowOwner('[1]', 'alice.near'), /ERR_ARGS/);
});

// House, Arena and the city import shared/board/call-as.js, which re-exports the
// browser module. Both sides must be the same functions, and the toll helpers
// (which main's own module did not have) must survive the merge on both paths.
test('the shared module and the browser module are the same envelope', () => {
  const names = ['CALL_AS_VERSION', 'BOARD_V2', 'injectRowOwner', 'effectsCanon', 'callAsMessage', 'confirmMessage',
    'refundActionArgs', 'settleArgs', 'unitsOf', 'crossArgs'];
  for (const name of names) {
    assert.ok(name in shared, `shared is missing ${name}`);
    assert.equal(shared[name], browser[name], `${name} differs between the two modules`);
  }
  assert.deepEqual(shared.BOARD_V2, {
    open: 'propose_call_as', confirm: 'confirm_hold', cancel: 'cancel_hold', expire: 'expire_sent', refund: 'refund_action', settle: 'settle',
  });
  assert.equal(shared.CALL_AS_VERSION, '2');
});

// The toll helpers main's module did not have. A row_owner the visitor typed is
// dropped, the real owner is appended, and the shop args hash over that text.
test('the toll helpers survive on both import paths', () => {
  for (const mod of [shared, browser]) {
    assert.equal(mod.unitsOf('0.00001', 18), '10000000000000');
    assert.equal(mod.unitsOf('1', 6), '1000000');
    assert.throws(() => mod.unitsOf('1.0000001', 6));
    const args = mod.crossArgs({
      actionId: '4', chain: 'base', asset: 'native', to: '0x2222222222222222222222222222222222222222',
      amount: '10000000000000', rowBudget: '10000000000000',
    });
    assert.equal(args, '{"action_id":4,"chain":"base","asset":"native","to":"0x2222222222222222222222222222222222222222","amount":"10000000000000","row_budget":"10000000000000"}');
    assert.equal(mod.injectRowOwner(args, 'visitor.near'),
      '{"action_id":4,"chain":"base","asset":"native","to":"0x2222222222222222222222222222222222222222","amount":"10000000000000","row_budget":"10000000000000","row_owner":"visitor.near"}');
    assert.deepEqual(mod.refundActionArgs('visitor.near', 4), { owner: 'visitor.near', action_id: '4' });
    assert.deepEqual(mod.settleArgs('visitor.near', 4), { owner: 'visitor.near', action_id: '4' });
  }
});

// The shared module is imported by the city bundle, so it must not pull in
// node:crypto. Only the re-export is allowed here.
test('the shared module stays free of node built-ins', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../../../shared/board/call-as.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /from\s+['"]node:/);
  assert.doesNotMatch(src, /require\(/);
});
