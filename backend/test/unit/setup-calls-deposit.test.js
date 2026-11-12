// The /setup call list against board v2's real storage charges.
// v2 bills the trie bytes, so a 0.005 NEAR set_calls deposit is refused with
// ERR_DEPOSIT, and a long shop list is refused with ERR_ROW_TOO_BIG.
// The numbers below are the sandbox measurements in
// contracts/charter_board_sandbox/tests/setup_calls_deposit.rs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FERRY_CALL_TARGETS, payoutsCalls, CALLS_DEPOSIT_YOCTO, EFFECT_BUDGET_FIRST_BYTES, EFFECT_BUDGET_MORE_BYTES, FOUR_SHOP_MAX_PAIRS, MAX_PAIR_BYTES, ROW_BYTES_PER_RECEIVER, ROW_FIXED_BYTES, ROW_STORAGE_BYTES, callPairBytes, callPolicy, callsFitRow, dropOptionalPairs, pairBudgetBytes, stampCalls } from '../../../shared/board/session.js';
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
  // 0.005 must not come back. The hold build adds a 1400-byte side reserve (0.014 NEAR) on top
  // of the pairs, so 0.015 is refused; 0.05 is what the sandbox test sends, and the rest is refunded.
  assert.equal(CALLS_DEPOSIT_YOCTO, (5n * 10n ** 22n).toString(), '0.05 NEAR');
  assert.ok(BigInt(CALLS_DEPOSIT_YOCTO) > 1400n * 10n ** 19n + YN / 1000n * 12n, 'above reserve + the measured pairs');
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
  // Those points were taken with the old 600-byte side reserve. The live board prepays 1400,
  // so its fixed cost is 800 bytes more, and its row cap is 0.04 NEAR = 4000 bytes.
  assert.equal(ROW_FIXED_BYTES, 1490 + 800);
  assert.equal(ROW_BYTES_PER_RECEIVER, 24);
  assert.equal(ROW_STORAGE_BYTES, 4000);
  assert.equal(pairBudgetBytes(1), 4000 - 2290 - 200 - 24);
  assert.equal(pairBudgetBytes(4), 4000 - 2290 - 200 - 24 * 4);
  // The three old live points still reproduce from the old fixed cost.
  for (const [receivers, locked] of [[1, 1916], [2, 1940], [3, 1964]]) {
    assert.equal(1490 + ROW_BYTES_PER_RECEIVER * receivers + 402, locked, `${receivers} receivers`);
  }
  // The live board, measured 2026-11-12: row 8ccd5d33 was opened in one tx (2YyLuwtn…) with
  // eight receivers and a 989-byte call list, and get_charter reports 3469 bytes locked. The
  // model says 2290 + 24*8 + 989 = 3471, two bytes pessimistic.
  assert.equal(ROW_FIXED_BYTES + ROW_BYTES_PER_RECEIVER * 8 + 989, 3471);
  assert.ok(3471 >= 3469 && 3471 - 3469 < 32);
});

test('a row with more receivers holds fewer pairs, which mainnet proved', () => {
  // On the old 2000-byte board the same live row held eight pairs next to three receivers and
  // refused them next to four (424 and 472 pair bytes refused, 375 landed). The arithmetic of
  // that board is kept here so the slope stays pinned.
  const oldBudget = n => 2000 - 1490 - 24 * n;
  assert.ok(368 <= oldBudget(4) && 424 > oldBudget(4) && 424 <= oldBudget(3));
  // The live 4000-byte board keeps the same slope: 24 bytes per extra receiver.
  assert.equal(pairBudgetBytes(1) - pairBudgetBytes(2), 24);
  assert.equal(pairBudgetBytes(6), 4000 - 2290 - 200 - 24 * 6);
  // and the 989-byte list the live row holds beside eight receivers is inside the budget.
  assert.ok(989 <= pairBudgetBytes(8));
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
  // 24 pairs with long ids is inside MAX_CALLS but outside one row's storage.
  const long = Array.from({ length: 24 }, (_, i) => ({ receiver: `s${i}${'x'.repeat(40)}.near`, method: 'ft_transfer' }));
  assert.equal(long.length, 24);
  assert.equal(callsFitRow(long), false);
});

test('callPairBytes counts the receiver, the method and the 16-byte cap', () => {
  assert.equal(callPairBytes('toll.nearcarta.near', 'ft_transfer'), 19 + 11 + 24);
  assert.equal(callPairBytes('wrap.near', 'near_deposit'), 9 + 12 + 24);
  // The budget is the pairs a row may hold, next to MAX_ROW_YOCTO = 4000 bytes.
  // MAX_PAIR_BYTES is the one-receiver case; a row with more receivers has less.
  assert.equal(MAX_PAIR_BYTES, pairBudgetBytes(1));
  assert.equal(MAX_PAIR_BYTES, 1486);
  assert.ok(MAX_PAIR_BYTES < 4000);
});

test('a refused set_calls says which refusal it was', () => {
  const plain = plainRulesError(new Error('Smart contract panicked: ERR_DEPOSIT'));
  assert.match(plain, /deposit did not cover the storage/);
  const big = plainRulesError(new Error('Smart contract panicked: ERR_ROW_TOO_BIG'));
  assert.match(big, /does not fit a row that holds 0\.04 NEAR/);
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

test('the optional pairs go before a shop does, and Plan A (root + Toll + Guard + House + Hall) fits', () => {
  // On the old 2000-byte board Town Hall's seven lifecycle pairs never fit beside three other
  // contract shops, so /setup could not open a row reaching the Hall or a plain Payouts payee.
  // The live board caps a row at 4000 bytes, so the film's Plan A list fits whole.
  const pairBytes = calls => calls.reduce((n, c) => n + callPairBytes(c.receiver, c.method), 0);
  const houseIf = recv => (recv.includes('house.nearcarta.near') ? HOUSE_CALLS : []);
  const build = shops => dropOptionalPairs(
    callPolicy(shops, CAP, DAILY, 'ft_transfer', payoutsCalls([...FERRY_CALL_TARGETS, ...stampCalls(BOARD, CAP), ...houseIf(shops)], CAP).calls).calls,
    shops.length,
  );
  const TOLL = 'toll.nearcarta.near', GUARD = 'guard.nearcarta.near', ARENA = 'arena.nearcarta.near';
  const HOUSE = 'house.nearcarta.near', HALL = 'townhall.nearcarta.near', ROOT = 'nearcarta.near';
  const reach = { [ROOT]: 'ft_transfer', [TOLL]: 'cross', [GUARD]: 'pay', [ARENA]: 'fund', [HOUSE]: 'house_session_check_in', [HALL]: 'post_job' };

  const planA = [ROOT, TOLL, GUARD, HOUSE, HALL];
  const a = build(planA);
  assert.equal(a.fits, true, 'Plan A fits one row');
  assert.deepEqual(a.dropped, [], 'nothing optional had to go');
  assert.equal(pairBytes(a.calls), 941);
  assert.equal(pairBudgetBytes(5), 1390);
  // Fixed + receivers + pairs = 3351 bytes, well under the 4000-byte cap.
  assert.ok(ROW_FIXED_BYTES + 24 * 5 + pairBytes(a.calls) < ROW_STORAGE_BYTES);
  for (const shop of planA) {
    assert.ok(a.calls.some(c => c.receiver === shop && c.method === reach[shop]), `${shop} is reachable on ${reach[shop]}`);
  }
  for (const shops of [[TOLL, GUARD, HOUSE, HALL], [TOLL, ARENA, HOUSE, HALL], [TOLL, GUARD, ARENA, HOUSE, HALL]]) {
    const t = build(shops);
    assert.equal(t.fits, true, shops.join(','));
    for (const shop of shops) assert.ok(t.calls.some(c => c.receiver === shop && c.method === reach[shop]), `${shop} reachable`);
  }
  // Even eight receivers (the contract's MAX_RECEIVERS) with long payee ids fit now.
  const payees = Array.from({ length: 3 }, (_, i) => `payee${i}${'x'.repeat(50)}.near`);
  assert.equal(build([TOLL, GUARD, HOUSE, HALL, ROOT, ...payees]).fits, true);
  // A list that does not fit has its optional pairs dropped first, each with a reason.
  const tight = dropOptionalPairs([...a.calls, ...Array.from({ length: 4 }, (_, i) => ({ receiver: `p${i}${'x'.repeat(60)}.near`, method: 'ft_transfer' }))], 8);
  assert.ok(tight.dropped.length > 0);
  for (const d of tight.dropped) assert.ok(d.why && d.why.length > 10, `${d.method} states why it was droppable`);
  // The wrap legs a swap needs are never dropped.
  assert.ok(tight.calls.some(c => c.receiver === 'wrap.near' && c.method === 'near_deposit'));
  assert.ok(tight.calls.some(c => c.receiver === 'wrap.near' && c.method === 'ft_transfer'));
});

test('effect budgets: the old 2000-byte row had no room, the live reserve pays them', () => {
  // Old board, measured 2026-11-07: a four-shop row was full at five pairs (1762 + 238 = 2000).
  assert.equal(FOUR_SHOP_MAX_PAIRS, 5);
  assert.equal(EFFECT_BUDGET_FIRST_BYTES, 351);
  assert.equal(EFFECT_BUDGET_MORE_BYTES, 34);
  assert.equal(1945 - 1594, EFFECT_BUDGET_FIRST_BYTES);
  assert.equal(1979 - 1945, EFFECT_BUDGET_MORE_BYTES);
  for (const [name, locked] of [['four shops', 1993], ['three shops', 1914], ['two pairs', 1683]]) {
    assert.ok(2000 - locked < EFFECT_BUDGET_FIRST_BYTES, `${name} had no room on the old board`);
  }
  // Live board: the 1400-byte side reserve is prepaid by set_calls, so a first effect budget and
  // a second cap come out of the reserve, and the cushion is still left on a fresh row.
  assert.ok(EFFECT_BUDGET_FIRST_BYTES + EFFECT_BUDGET_MORE_BYTES < 1400);
});
