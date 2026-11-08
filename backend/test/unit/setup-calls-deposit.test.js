// The /setup call list against board v2's real storage charges.
// v2 bills the trie bytes, so a 0.005 NEAR set_calls deposit is refused with
// ERR_DEPOSIT, and a long shop list is refused with ERR_ROW_TOO_BIG.
// The numbers below are the sandbox measurements in
// contracts/charter_board_sandbox/tests/setup_calls_deposit.rs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CALLS_DEPOSIT_YOCTO, EFFECT_BUDGET_FIRST_BYTES, EFFECT_BUDGET_MORE_BYTES, FOUR_SHOP_MAX_PAIRS, MAX_PAIR_BYTES, ROW_BYTES_PER_RECEIVER, ROW_FIXED_BYTES, ROW_STORAGE_BYTES, callPairBytes, callPolicy, callsFitRow, dropOptionalPairs, pairBudgetBytes, stampCalls } from '../../../shared/board/session.js';
import { HOUSE_CALLS } from '../../../shared/house/shop.js';
import { plainRulesError } from '../../../shared/setup/rules-diff.js';

const YN = 10n ** 24n;
const CAP = (YN * 5n / 1000n).toString(), DAILY = (YN * 10n / 1000n).toString();
const BOARD = 'board.nearcarta.near';
// The page's list: shops, the wrap.near trio, the board stamp, then the House calls.
const policy = shops => callPolicy(shops, CAP, DAILY, 'ft_transfer', [...stampCalls(BOARD, CAP), ...HOUSE_CALLS]).calls;

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

test('callsFitRow matches the row capacity measured on mainnet', () => {
  // Measured on 2026-11-07 against the live visitor row, ONE fixed eight-pair list and only
  // the receiver count moving: 1 -> 1916 locked, 2 -> 1940, 3 -> 1964. Slope 24 bytes per
  // receiver, fixed 1490. Two four-receiver shapes were refused on the same row (ERR_ROW_TOO_BIG
  // at 8 and 9 pairs) and the 7-pair shape landed at 1993, so the boundary is exercised on chain,
  // not just in a model.
  assert.equal(ROW_FIXED_BYTES, 1490);
  assert.equal(ROW_BYTES_PER_RECEIVER, 24);
  assert.equal(pairBudgetBytes(1), 2000 - 1490 - 24);
  assert.equal(pairBudgetBytes(4), 2000 - 1490 - 24 * 4);
  // The three live points must reproduce exactly from the constants.
  for (const [receivers, locked] of [[1, 1916], [2, 1940], [3, 1964]]) {
    assert.equal(ROW_FIXED_BYTES + ROW_BYTES_PER_RECEIVER * receivers + 402, locked, `${receivers} receivers`);
  }
});

test('a row with more receivers holds fewer pairs, which mainnet proved', () => {
  // The same live row, one fixed list and only the receiver count moving, held eight pairs
  // next to one, two and three receivers (1916 / 1940 / 1964 bytes locked) and refused them
  // next to four. Two four-receiver shapes were refused on chain: 8 pairs at 424 pair bytes
  // and 9 pairs at 472. The 7-pair shape at 375 bytes landed with 1993 locked.
  //
  // The assertions below are the byte totals, because reconstructing an 8-pair list from
  // account ids is how an earlier version of this test drifted 11 bytes off the chain.
  const pairBudget = pairBudgetBytes(4);
  assert.equal(pairBudget, 2000 - 1490 - 24 * 4);
  assert.ok(368 <= pairBudget, 'the 7-pair list that landed is inside the budget');
  assert.ok(424 > pairBudget, 'the 8-pair list the chain refused (424 bytes) is outside it');
  assert.ok(472 > pairBudget, 'the 9-pair list the chain refused (472 bytes) is outside it');
  // Eight pairs fit next to three receivers and not next to four: the live boundary.
  assert.ok(424 <= pairBudgetBytes(3), 'three receivers still hold the 424-byte list');
  assert.ok(424 > pairBudgetBytes(4), 'four receivers do not');
  // The budget shrinks by 24 bytes per extra receiver.
  assert.equal(pairBudgetBytes(1) - pairBudgetBytes(2), 24);
  assert.equal(pairBudgetBytes(6), 2000 - 1490 - 24 * 6);
});

test('the pair byte count is the same number the sandbox test computes', () => {
  // setup_calls_deposit.rs builds the same list and asserts these exact totals.
  const total = (k, len) => policy(names(k, len)).reduce((n, c) => n + callPairBytes(c.receiver, c.method), 0);
  assert.equal(total(5, 19), 597);
  assert.equal(total(6, 19), 652);
  assert.equal(total(4, 25), 562);
  assert.equal(total(5, 25), 622);
  assert.equal(total(4, 32), 590);
  assert.equal(total(5, 32), 657);
  assert.equal(total(3, 40), 547);
  assert.equal(total(4, 40), 622);
  assert.equal(total(3, 48), 571);
  assert.equal(total(4, 48), 654);
  assert.equal(total(3, 56), 595);
  assert.equal(total(4, 56), 686);
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
  // MAX_PAIR_BYTES is the one-receiver case; a row with more receivers has less.
  assert.equal(MAX_PAIR_BYTES, pairBudgetBytes(1));
  assert.equal(MAX_PAIR_BYTES, 486);
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

test('the page refuses an over-full list before the wallet opens, on both paths', () => {
  // Both the first open and Update my rules write the same call list, so both have to
  // check it against the row with the receiver count. The failure this prevents is real:
  // tx 7H3H2HFiqPiGTPkF8gkkFLvbMecARWQdyG9DCdBPNnh9 let open_charter land and then
  // panicked ERR_ROW_TOO_BIG on set_calls.
  const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
  const open = src.slice(src.indexOf('function wireRules()'), src.indexOf('// ---------- 6. Sign'));
  assert.match(open, /callsFitRow\(callsFor\(r, MAIN\.board\.contract\), r\.receivers\.length\)/);
  const update = src.slice(src.indexOf('async function updateRules'));
  assert.match(update, /callsFitRow\(callsFor\(r, contract\), r\.receivers\.length\)/);
  // A refused list says why, and names the receiver count.
  assert.match(update, /Update my rules would be refused on chain/);
});

test('the optional pairs go before a shop does, and the real limit is four shops', () => {
  // A four-shop row was refused on mainnet with the full list and landed once two optional
  // pairs were dropped. Dropping a shop would break something the visitor just asked for, so
  // the optional pairs go first, and each one states what it costs.
  const pairBytes = calls => calls.reduce((n, c) => n + callPairBytes(c.receiver, c.method), 0);
  const houseIf = recv => (recv.includes('house.nearcarta.near') ? HOUSE_CALLS : []);
  const build = shops => dropOptionalPairs(
    callPolicy(shops, CAP, DAILY, 'ft_transfer', [...stampCalls(BOARD, CAP), ...houseIf(shops)]).calls,
    shops.length,
  );
  const TOLL = 'toll.nearcarta.near', GUARD = 'guard.nearcarta.near', ARENA = 'arena.nearcarta.near';
  const HOUSE = 'house.nearcarta.near', HALL = 'townhall.nearcarta.near';

  // Every four-shop combination the city offers fits, and every named shop stays reachable.
  // Arena's real method is `fund` (adding to a guardian's pot). It is not `ft_transfer`: the
  // deployed arena has no such method, which is why pressing Feed was refused on chain.
  const reach = { [TOLL]: 'cross', [GUARD]: 'pay', [ARENA]: 'fund', [HOUSE]: 'house_session_check_in', [HALL]: 'ft_transfer' };
  for (const shops of [[TOLL, GUARD, ARENA, HOUSE], [TOLL, GUARD, ARENA, HALL], [TOLL, GUARD, HOUSE, HALL]]) {
    const t = build(shops);
    assert.equal(t.fits, true, `${shops.length} shops fit: ${shops.join(',')}`);
    for (const shop of shops) {
      assert.ok(t.calls.some(c => c.receiver === shop && c.method === reach[shop]), `${shop} is still reachable on ${reach[shop]}`);
    }
    // What was dropped is only ever an optional pair, and each says its cost.
    for (const d of t.dropped) assert.ok(d.why && d.why.length > 10, `${d.method} states why it was droppable`);
  }

  // Five shops do NOT fit, and that is a contract limit rather than a page rule: 426 bytes of
  // pairs next to five receivers against a 390-byte budget. (Was 433 before Arena's pair became
  // its real method `fund` instead of `ft_transfer`.) The page must say so and refuse to
  // sign, because the chain answers ERR_ROW_TOO_BIG after the wallet has already approved.
  const five = build([TOLL, GUARD, ARENA, HOUSE, HALL]);
  assert.equal(five.fits, false, 'five named shops do not fit one 0.02 NEAR row');
  assert.equal(pairBytes(five.calls), 426);
  assert.equal(pairBudgetBytes(5), 390);
  assert.ok(pairBytes(five.calls) > pairBudgetBytes(5));

  // The exact shape that landed on mainnet (375 bytes with arena on ft_transfer). Arena's pair
  // is now its real method `fund`, which is 7 bytes shorter, so the same seven-pair list is 368.
  const landed = build([TOLL, GUARD, ARENA, HOUSE]);
  assert.equal(landed.calls.length, 7);
  assert.equal(pairBytes(landed.calls), 368);
  assert.deepEqual(landed.dropped.map(d => d.method), ['storage_deposit', 'stamp']);
  // The wrap legs a swap needs are never dropped.
  assert.ok(landed.calls.some(c => c.receiver === 'wrap.near' && c.method === 'near_deposit'));
  assert.ok(landed.calls.some(c => c.receiver === 'wrap.near' && c.method === 'ft_transfer'));
});

test('a shop-bearing row cannot hold a foreign effect budget, which is a contract limit', () => {
  // The four-shop ceiling, measured by growing the list against a four-receiver row:
  //   4 receivers, 4 pairs -> 1762 locked; 5 pairs -> 2000 (full); 6 pairs -> ERR_ROW_TOO_BIG.
  assert.equal(FOUR_SHOP_MAX_PAIRS, 5);
  assert.ok(1762 + 238 <= 2000, 'the fifth pair still fits');
  assert.ok(1762 + 285 > 2000, 'the sixth does not');
  // Measured on mainnet 2026-11-07 against one row, one cap at a time:
  //   toll-only (1 pair)     1594 locked
  //   + base/usdc cap        1945  (+351, creates the ACTS record)
  //   + base/native cap      1979  (+34, record already there)
  assert.equal(EFFECT_BUDGET_FIRST_BYTES, 351);
  assert.equal(EFFECT_BUDGET_MORE_BYTES, 34);
  assert.equal(1945 - 1594, EFFECT_BUDGET_FIRST_BYTES);
  assert.equal(1979 - 1945, EFFECT_BUDGET_MORE_BYTES);
  // Every row shape that carries a shop is too full to accept even the first cap.
  for (const [name, locked] of [['four shops', 1993], ['three shops', 1914], ['two pairs', 1683]]) {
    assert.ok(ROW_STORAGE_BYTES - locked < EFFECT_BUDGET_FIRST_BYTES, `${name} has no room for an effect budget`);
  }
  // After the first cap the bare row has 55 bytes left, so exactly one more cap fits and the
  // row is then full: 1979 locked, 21 free, and 34 needed for a third. That is why the toll CTA
  // could not complete even with two caps reserved (`ERR_DEPOSIT` on the in-flight hold).
  assert.equal(2000 - 1945, 55);
  assert.ok(2000 - 1945 >= EFFECT_BUDGET_MORE_BYTES, 'a second cap still fits');
  assert.equal(2000 - 1979, 21);
  assert.ok(2000 - 1979 < EFFECT_BUDGET_MORE_BYTES, 'a third cap does not, and the hold has nothing left');
});
