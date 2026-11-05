import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tryTiles } from '../../../shared/setup/try-tiles.js';
import { reasonLabel } from '../../../shared/net/reasons.js';
import { txUrl } from '../../../shared/net/explorer.js';
import { requireMainnetReceiver } from '../../../shared/net/accounts.js';

test('try tiles stay disabled when no payments are left today', () => {
  const none = tryTiles({ actionsToday: 3, maxPerDay: 3 });
  assert.equal(none.left, 0);
  assert.equal(none.allowDisabled, true);
  assert.match(none.allowReason, /0 of 3 left today/);
  const some = tryTiles({ actionsToday: 1, maxPerDay: 3 });
  assert.equal(some.left, 2);
  assert.equal(some.allowDisabled, false);
});

test('refusal codes use a sentence, and explorer links are mainnet', () => {
  assert.equal(reasonLabel('receiver_not_allowlisted'), 'Refused: payee not on your list');
  assert.equal(reasonLabel('over_per_action_cap'), 'Refused: over the per-payment cap');
  assert.equal(txUrl('8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR').startsWith('https://nearblocks.io/txns/'), true);
});

test('a receiver must be a .near account or a 64-hex implicit account', () => {
  assert.equal(requireMainnetReceiver('shop-moved-pay-here.near'), 'shop-moved-pay-here.near');
  assert.equal(requireMainnetReceiver('ab'.repeat(32)), 'ab'.repeat(32));
  assert.throws(() => requireMainnetReceiver('shop.example'), /mainnet/);
  assert.throws(() => requireMainnetReceiver(''), /mainnet/);
});
