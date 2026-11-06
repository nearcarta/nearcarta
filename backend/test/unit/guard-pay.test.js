import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_ENFORCEMENT, VERIFIER_VERSION, bindVerdict, classifyCheck, contextDigest, contextMatches, createLedger,
} from '../../../shared/guard/verifier.js';

const now = 1_700_000_000_000;
const fields = { payee: 'cafe.near', chain: 'near', asset: 'NEAR', amount: '0.002', invoice: 'coffee', row: 'row.near', keyEpoch: '1', policyVersion: '2' };

test('unknown stays unknown and a deny list is a block', () => {
  assert.equal(classifyCheck({ verdict: 'warn', reasons: [{ code: 'age_unknown' }] }), 'unknown');
  assert.equal(classifyCheck({ verdict: 'allow', reasons: [{ code: 'code_unknown' }] }), 'unknown');
  assert.equal(classifyCheck({ verdict: 'block', reasons: [{ code: 'denylisted' }] }), 'block');
  assert.equal(classifyCheck({ verdict: 'warn', reasons: [{ code: 'new_account', level: 'warn' }] }), 'warn');
  assert.equal(classifyCheck({ verdict: 'allow', reasons: [] }), 'allow');
  assert.equal(classifyCheck(null), 'unknown');
});

test('an edited amount, payee, invoice, row, chain or key rejects the old verdict', () => {
  const bound = bindVerdict({ ...fields, check: { verdict: 'allow', reasons: [] } }, now);
  assert.equal(bound.version, VERIFIER_VERSION);
  assert.equal(bound.live, LIVE_ENFORCEMENT);
  assert.equal(contextMatches(bound, fields), true);
  for (const patch of [
    { amount: '0.003' }, { payee: 'other.near' }, { invoice: 'tea' }, { row: 'other-row' },
    { chain: 'base' }, { keyEpoch: '2' }, { policyVersion: '9' }, { asset: 'USDC' },
  ]) {
    assert.equal(contextMatches(bound, { ...fields, ...patch }), false, JSON.stringify(patch));
  }
  assert.notEqual(contextDigest(fields), contextDigest({ ...fields, amount: '0.003' }));
});

test('a warning needs a person, a block refunds once, and an allow does not sign', () => {
  const book = createLedger();
  const warn = bindVerdict({ ...fields, check: { verdict: 'warn', reasons: [{ code: 'new_account' }] } }, now);
  const held = book.pay(warn, now);
  assert.equal(held.status, 'held');
  assert.equal(held.needsHuman, true);
  assert.equal(book.confirm(warn.id, { actor: 'agent', intentDigest: warn.digest }, now).ok, false);
  assert.equal(book.confirm(warn.id, { actor: 'human', intentDigest: 'nope' }, now).status, 'mismatch');
  const released = book.confirm(warn.id, { actor: 'human', intentDigest: warn.digest }, now);
  assert.equal(released.status, 'prepared');
  assert.equal(released.signed, false);
  assert.equal(released.tx, null);
  assert.equal(released.forward.payee, 'cafe.near');
  assert.equal(released.forward.amount, '0.002');
  assert.equal(book.pay(warn, now).status, 'replay');

  const block = bindVerdict({ ...fields, amount: '0.004', check: { verdict: 'block', reasons: [{ code: 'denylisted' }] } }, now);
  const refunded = book.pay(block, now);
  assert.equal(refunded.status, 'refunded');
  assert.equal(refunded.refund.destination, 'visitor-row');
  assert.equal(refunded.refund.boardTransfer, false);
  assert.equal(book.pay(block, now).status, 'replay');
  assert.equal(book.cancel(block.id, now).duplicate, true);

  const allow = bindVerdict({ ...fields, amount: '0.005', check: { verdict: 'allow', reasons: [] } }, now);
  const prepared = book.pay(allow, now);
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.live, 'blocked');
  assert.equal(prepared.signed, false);
  assert.deepEqual(prepared.forward, { payee: 'cafe.near', chain: 'near', asset: 'NEAR', amount: '0.005', row: 'row.near' });

  const foreign = bindVerdict({ ...fields, amount: '0.006', chain: 'base', check: { verdict: 'allow', reasons: [] } }, now);
  assert.match(book.pay(foreign, now).hint, /Foreign spend/);
});

test('a hold expires once and cancel does not refund twice', () => {
  const book = createLedger();
  const warn = bindVerdict({ ...fields, amount: '0.007', check: { verdict: 'unknown', reasons: [{ code: 'age_unknown' }] } }, now);
  assert.equal(warn.release, 'warn');
  book.pay(warn, now);
  const late = book.expire(now + 11 * 60 * 1000);
  assert.equal(late.length, 1);
  assert.equal(late[0].refund.why, 'timeout');
  assert.equal(book.expire(now + 12 * 60 * 1000).length, 0);
  const again = bindVerdict({ ...fields, amount: '0.008', check: { verdict: 'warn', reasons: [{ code: 'new_account' }] } }, now);
  book.pay(again, now);
  assert.equal(book.cancel(again.id, now).status, 'refunded');
  assert.equal(book.cancel(again.id, now).duplicate, true);
});
