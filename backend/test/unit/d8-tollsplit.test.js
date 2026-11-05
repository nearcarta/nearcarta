import test from 'node:test';
import assert from 'node:assert/strict';
import * as TS from '../../../app/design/D8_shops/js/tollsplit.js';

const Y = n => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
test('the toll split is one batch: the toll leg opens the gate, then treasury and agent budget', () => {
  const b = TS.planSplit({ payee: 'cafe.ncpub-17102.testnet', nonce: 7, policy: 2, nowMs: 1e12 });
  assert.equal(b.n, 3);
  assert.deepEqual(b.ps.map(p => p.receiver), ['cafe.ncpub-17102.testnet', TS.SPLIT.treasury, TS.SPLIT.agent]);
  assert.deepEqual(b.ps.map(p => p.nonce), ['7', '8', '9']);
  assert.equal(b.ps[0].memo, 'toll', 'the toll leg names the toll');
  assert.ok(BigInt(b.ps[0].amount) >= Y(0.01), 'the toll leg pays at least the gate fee');
  const sum = b.ps.reduce((s, p) => s + BigInt(p.amount), 0n);
  assert.equal(sum, Y(TS.SPLIT_TOTAL));
  assert.ok(b.ps.every(p => BigInt(p.amount) >= Y(0.001)), 'every leg is at or above the default min amount');
  assert.equal(TS.SPLIT.treasury, 'townhall.nearcarta.near');
  assert.ok(b.gasTgas >= 30 + 25 * 3);
});
test('a charter splits only with batches and all three payees in its rules', () => {
  const all = ['cafe.x', TS.SPLIT.treasury, TS.SPLIT.agent];
  assert.equal(TS.canSplit(all, 'cafe.x', true), true);
  assert.equal(TS.canSplit(all, 'cafe.x', false), false);
  assert.equal(TS.canSplit(['cafe.x', TS.SPLIT.treasury], 'cafe.x', true), false);
  assert.throws(() => TS.planSplit({ payee: null, nonce: 0, policy: 1, nowMs: 0 }));
});

test('mainnet toll refuses when toll.nearcarta.near is not on the allowlist (never another shop)', () => {
  assert.equal(TS.TOLL_ACCT, 'toll.nearcarta.near');
  assert.equal(TS.tollAllowed(['cafe.near', 'bakery.near']), false);
  assert.equal(TS.tollAllowed(undefined), false);
  assert.equal(TS.tollAllowed(['cafe.near', 'toll.nearcarta.near']), true);
  assert.equal(TS.TOLL_NOT_LISTED, 'Add toll.nearcarta.near to your allowlist first');
});
