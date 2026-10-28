import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { commitment, oathMemo, streetCheck, parseLedger, deskRequests, verifyOpening } from '../../src/mistbank.js';
import { DEP } from '../../src/config.js';

const fx = f => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8');
const payout = JSON.parse(fx('zec-testnet-mistbank-payout.json'));   // our payout, Ironwood -> Ironwood
const crossing = JSON.parse(fx('zec-testnet-faucet-crossing.json')); // a faucet payment that crosses pools
// Synthetic list-tx output (made-up amount, salt and txid): the real opening is auditor-only.
const FX_TX = 'ab'.repeat(32), FX_AMOUNT = 4200000, FX_SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const AUDITOR = process.env.MIST_AUDITOR_FILE; // optional: the auditor's copy, never in the repo

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
  const c = commitment(FX_AMOUNT, FX_SALT);
  assert.match(c, /^[0-9a-f]{64}$/);
  assert.ok(Buffer.byteLength(oathMemo(c)) <= 64);
  assert.notEqual(commitment(FX_AMOUNT + 1, FX_SALT), c); // one zat changes it
});

test('the auditor parses amount and salt from a view-only list-tx and rebuilds the commitment', () => {
  const l = parseLedger(fx('zec-testnet-view-list-tx.txt'), FX_TX);
  assert.equal(l.zats, FX_AMOUNT); assert.equal(l.height, 4500000);
  const salt = l.memo.match(/salt=([0-9a-f]{32})/)[1];
  assert.equal(salt, FX_SALT);
  const p = { commitment: { value: commitment(FX_AMOUNT, FX_SALT) } };
  assert.equal(verifyOpening(String(l.zats), salt, p).matches, true);
  assert.equal(parseLedger(fx('zec-testnet-view-list-tx.txt'), 'f'.repeat(64)), null);
});

test('the public record carries no viewing key, amount or salt', () => {
  const blob = JSON.stringify(DEP);
  assert.doesNotMatch(blob, /uview(test)?1|salt=|"zats"|payee_address/);
  assert.equal(DEP.mistbank.ledger, undefined); assert.equal(DEP.mistbank.disclosure, undefined);
  assert.match(DEP.mistbank.commitment.value, /^[0-9a-f]{64}$/);
});

test('real payout: the auditor opening matches the commitment on chain', { skip: !(AUDITOR && existsSync(AUDITOR)) && 'set MIST_AUDITOR_FILE (auditor only)' }, () => {
  const a = JSON.parse(readFileSync(AUDITOR, 'utf8'));
  const salt = a.ledger.memo.match(/salt=([0-9a-f]{32})/)[1];
  assert.ok(a.ledger.memo.includes(DEP.mistbank.oath.tx));
  assert.equal(verifyOpening(String(a.ledger.zats), salt).matches, true);
  assert.equal(oathMemo(DEP.mistbank.commitment.value), DEP.mistbank.oath.memo);
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
  const p = { commitment: { value: commitment(FX_AMOUNT, FX_SALT) } };
  assert.equal(verifyOpening(String(FX_AMOUNT), FX_SALT, p).matches, true);
  assert.equal(verifyOpening(String(FX_AMOUNT + 1), FX_SALT, p).matches, false);
  assert.equal(verifyOpening(String(FX_AMOUNT), FX_SALT).matches, false); // not the real payout's opening
  assert.ok(!('salt' in verifyOpening(String(FX_AMOUNT), FX_SALT, p))); // never echoes the opening
  assert.throws(() => verifyOpening('1.5', 'zz'));
});
