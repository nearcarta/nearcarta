import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callAsMessage, confirmMessage, injectRowOwner } from '../../../shared/board/call-as.js';

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
