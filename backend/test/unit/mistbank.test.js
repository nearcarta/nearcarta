import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commitment, oathMemo, streetCheck, parseLedger, deskRequests, verifyOpening } from '../../src/mistbank.js';
import { DEP } from '../../src/config.js';

const fx = f => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8');
const payout = JSON.parse(fx('zec-testnet-mistbank-payout.json'));   // our payout, Ironwood -> Ironwood
const crossing = JSON.parse(fx('zec-testnet-faucet-crossing.json')); // a faucet payment that crosses pools
const PAYOUT = 'd0b520673362ff6acd8d4ff9eb87beda9fa89f258ed9a07a5ffc57dfbcfa6897';

test('the street sees our payout, but no amount: only the fee leaves the pool', () => {
  const s = streetCheck(payout);
  assert.equal(s.amount_hidden, true, s.reasons.join());
  assert.equal(s.fee_zat, '20000');
  assert.deepEqual(s.reasons, []);
});

test('a pool-crossing payment leaks its amount through the value balance', () => {
  const s = streetCheck(crossing);
  assert.equal(s.amount_hidden, false);
  assert.ok(s.reasons.includes('pool_crossing_reveals_amount'));
});

test('transparent parts and coinbase are flagged', () => {
  assert.ok(streetCheck({ ...payout, outputs: [{ value: 1 }] }).reasons.includes('transparent_inputs_or_outputs'));
  assert.ok(streetCheck({ ...payout, isCoinbase: true }).reasons.includes('coinbase'));
});

test('the oath memo is a commitment that fits the 64-byte oath limit', () => {
  const c = commitment(1370000, '67d50c7f78cc0cfdc145392edd674f83');
  assert.match(c, /^[0-9a-f]{64}$/);
  assert.ok(Buffer.byteLength(oathMemo(c)) <= 64);
  assert.notEqual(commitment(1370001, '67d50c7f78cc0cfdc145392edd674f83'), c); // one zat changes it
});

test('the ledger opened with the viewing key binds to the commitment recorded on chain', () => {
  const l = parseLedger(fx('zec-testnet-view-list-tx.txt'), PAYOUT);
  assert.equal(l.zats, 1370000); assert.equal(l.height, 4549357);
  const salt = l.memo.match(/salt=([0-9a-f]{32})/)[1], oathTx = l.memo.match(/oath=(\w+)/)[1];
  assert.equal(oathTx, DEP.mistbank.oath.tx);
  assert.equal(commitment(l.zats, salt), DEP.mistbank.commitment.value);
  assert.equal(oathMemo(DEP.mistbank.commitment.value), DEP.mistbank.oath.memo);
  assert.equal(parseLedger(fx('zec-testnet-view-list-tx.txt'), 'f'.repeat(64)), null);
});

test('desk requests are dry and always name the privacy level (1Click defaults it silently)', () => {
  for (const p of ['basic', 'advanced']) {
    const r = deskRequests(p, 0);
    for (const b of Object.values(r)) { assert.equal(b.dry, true); assert.equal(b.confidentiality, p); }
    assert.equal(r.shield.recipientType, 'CONFIDENTIAL_INTENTS'); assert.equal(r.shield.depositType, 'ORIGIN_CHAIN');
    assert.equal(r.transfer.depositType, 'CONFIDENTIAL_INTENTS'); assert.equal(r.transfer.recipientType, 'CONFIDENTIAL_INTENTS');
    assert.equal(r.unshield.recipientType, 'INTENTS');
  }
});

test('the opening check matches the recorded commitment and rejects any other amount', () => {
  assert.equal(verifyOpening('1370000', '67d50c7f78cc0cfdc145392edd674f83').matches, true);
  assert.equal(verifyOpening('1370001', '67d50c7f78cc0cfdc145392edd674f83').matches, false);
  assert.throws(() => verifyOpening('1.5', 'zz'));
});
