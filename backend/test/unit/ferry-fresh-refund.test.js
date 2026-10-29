import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyPair } from 'near-api-js';
import { freshRefund, checkFreshRefund, implicitId } from '../../src/ferry.js';

test('freshRefund makes a new implicit account per swap, owned by its own key', () => {
  const used = new Set(), seen = new Set();
  for (let i = 0; i < 50; i++) {
    const r = freshRefund(used);
    assert.match(r.accountId, /^[0-9a-f]{64}$/);
    assert.equal(implicitId(KeyPair.fromString(r.private_key).getPublicKey()), r.accountId);
    assert.equal(r.public_key, KeyPair.fromString(r.private_key).getPublicKey().toString());
    assert.ok(!seen.has(r.accountId)); seen.add(r.accountId);
  }
  assert.equal(used.size, 50);
});

test('checkFreshRefund refuses reuse, the wallet, the recipient and named accounts', () => {
  const used = new Set();
  const a = freshRefund(used).accountId, b = freshRefund().accountId;
  assert.equal(checkFreshRefund(b, { used, wallet: 'w.testnet', recipient: 'w.testnet' }).ok, true);
  assert.match(checkFreshRefund(a, { used }).why, /already used/);
  assert.match(checkFreshRefund(b, { wallet: b }).why, /payer wallet/);
  assert.match(checkFreshRefund(b, { recipient: b }).why, /recipient/);
  assert.match(checkFreshRefund('r14rcv-46135.testnet').why, /one-time/);
});
