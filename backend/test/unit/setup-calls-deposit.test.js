// The /setup call list against board v2's real storage charges.
// v2 bills the trie bytes, so a 0.005 NEAR set_calls deposit is refused with
// ERR_DEPOSIT, and a long shop list is refused with ERR_ROW_TOO_BIG.
// The numbers below are the sandbox measurements in
// contracts/charter_board_sandbox/tests/setup_calls_deposit.rs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CALLS_DEPOSIT_YOCTO, MAX_PAIR_BYTES, callPairBytes, callPolicy, callsFitRow, stampCalls } from '../../../shared/board/session.js';
import { plainRulesError } from '../../../shared/setup/rules-diff.js';

const YN = 10n ** 24n;
const CAP = (YN * 5n / 1000n).toString(), DAILY = (YN * 10n / 1000n).toString();
const BOARD = 'board.nearcarta.near';
const policy = shops => callPolicy(shops, CAP, DAILY, 'ft_transfer', stampCalls(BOARD, CAP)).calls;

// Realistic shop ids padded to a chosen length, ending in .nearcarta.near.
const names = (n, len) => Array.from({ length: n }, (_, i) => {
  const head = `shop${i}`, tail = '.nearcarta.near';
  return head + 'x'.repeat(Math.max(0, len - head.length - tail.length)) + tail;
});

test('the set_calls deposit covers the default list and the widest that fits', () => {
  // The page attaches this to set_calls. The sandbox refused 0.005 with ERR_DEPOSIT
  // for the default one-shop list and accepted 0.012 for it, so anything at or below
  // 0.005 must not come back. 0.015 leaves room for the whole list plus the margin.
  assert.equal(CALLS_DEPOSIT_YOCTO, (15n * 10n ** 21n).toString(), '0.015 NEAR');
  assert.ok(BigInt(CALLS_DEPOSIT_YOCTO) > YN / 1000n * 12n, 'above the measured 0.012 NEAR');
  assert.ok(BigInt(CALLS_DEPOSIT_YOCTO) < YN / 1000n * 20n, 'still under the 0.02 NEAR row deposit');
  // What actually refuses 0.005 is the write: the side record is 895 bytes and the
  // default list is 240 more, so the deposit has to clear about 0.0116 NEAR.
  assert.ok(BigInt(CALLS_DEPOSIT_YOCTO) > 1160n * 10n ** 19n);
});

test('callsFitRow matches the row capacity measured in the sandbox', () => {
  // name length -> most shops the row held, from setup_calls_deposit.rs.
  for (const [len, fit] of [[19, 7], [25, 6], [32, 6], [40, 5], [48, 5], [56, 4]]) {
    assert.equal(callsFitRow(policy(names(fit, len))), true, `${fit} shops of ${len} bytes should fit`);
    assert.equal(callsFitRow(policy(names(fit + 1, len))), false, `${fit + 1} shops of ${len} bytes should not fit`);
  }
});

test('the pair byte count is the same number the sandbox test computes', () => {
  // setup_calls_deposit.rs builds the same list and asserts these exact totals.
  const total = (k, len) => policy(names(k, len)).reduce((n, c) => n + callPairBytes(c.receiver, c.method), 0);
  assert.equal(total(7, 19), 571);
  assert.equal(total(8, 19), 626);
  assert.equal(total(6, 25), 546);
  assert.equal(total(7, 25), 606);
  assert.equal(total(6, 32), 588);
  assert.equal(total(7, 32), 655);
  assert.equal(total(5, 40), 561);
  assert.equal(total(6, 40), 636);
  assert.equal(total(5, 48), 601);
  assert.equal(total(6, 48), 684);
  assert.equal(total(4, 56), 550);
  assert.equal(total(5, 56), 641);
});

test('the default /setup list always fits a row', () => {
  assert.equal(callsFitRow(policy(['toll.nearcarta.near'])), true);
  assert.equal(callsFitRow(policy(['wrap.near'])), true);
  // 24 short pairs is well inside MAX_CALLS but far outside one row's storage.
  const short = Array.from({ length: 24 }, (_, i) => ({ receiver: `s${i}.near`, method: 'm' }));
  assert.equal(short.length, 24);
  assert.equal(callsFitRow(short), false);
});

test('callPairBytes counts the receiver, the method and the 16-byte cap', () => {
  assert.equal(callPairBytes('toll.nearcarta.near', 'ft_transfer'), 19 + 11 + 24);
  assert.equal(callPairBytes('wrap.near', 'near_deposit'), 9 + 12 + 24);
  // The budget is the pairs a row may hold, next to MAX_ROW_YOCTO = 2000 bytes.
  assert.equal(MAX_PAIR_BYTES, 602);
  assert.ok(MAX_PAIR_BYTES < 2000);
});

test('a refused set_calls says which refusal it was', () => {
  const plain = plainRulesError(new Error('Smart contract panicked: ERR_DEPOSIT'));
  assert.match(plain, /deposit did not cover the storage/);
  const big = plainRulesError(new Error('Smart contract panicked: ERR_ROW_TOO_BIG'));
  assert.match(big, /does not fit a row that holds 0\.02 NEAR/);
  const partial = plainRulesError(new Error('Smart contract panicked: ERR_ROW_TOO_BIG'), { rulesSaved: true });
  assert.match(partial, /^set_rules was saved\./);
});
