// The /setup reopen that failed on prod after the gas fix.
//
// Tx 7H3H2HFiqPiGTPkF8gkkFLvbMecARWQdyG9DCdBPNnh9 opened a six-receiver row, then
// panicked ERR_ROW_TOO_BIG on set_calls with 11 pairs. Gas was fine (6.80 of 60 Tgas).
// Two things combined: the saved rules still named charter.nearcarta.near, which is
// retired, and the call list was one pair wider than a six-receiver row can hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };
import { liveShops, migrateShops, namesRetired } from '../../../shared/setup/rules-diff.js';
import {
  callPolicy, callsFitRow, callPairBytes, pairBudgetBytes, fittingShops, methodsForShop, stampCalls, SHOP_METHODS,
} from '../../../shared/board/session.js';
import { HOUSE_CALLS, HOUSE_SHOP } from '../../../shared/house/shop.js';

const YN = 10n ** 24n;
const CAP = (YN * 5n / 1000n).toString(), DAILY = (YN * 10n / 1000n).toString();
const BOARD = MAIN.board.contract;
const RETIRED = Object.keys(MAIN.retired || {});
const build = receivers => callPolicy(receivers, CAP, DAILY, 'ft_transfer', [...stampCalls(BOARD, CAP), ...HOUSE_CALLS]).calls;
const bytesOf = calls => calls.reduce((n, c) => n + callPairBytes(c.receiver, c.method), 0);

test('charter.nearcarta.near is retired, so it is dropped from a shop list', () => {
  assert.ok(RETIRED.includes('charter.nearcarta.near'), 'the deployment record says it is retired');
  // The exact saved list that broke the reopen.
  const saved = ['charter.nearcarta.near', 'toll.nearcarta.near', 'wrap.near', 'arena.nearcarta.near', 'house.nearcarta.near', 'townhall.nearcarta.near'];
  const live = liveShops(saved, RETIRED);
  assert.equal(live.includes('charter.nearcarta.near'), false, 'the retired account is gone');
  assert.equal(live.length, saved.length - 1);
  // Order is kept and duplicates collapse.
  assert.deepEqual(sorted(live), sorted(saved.filter(s => s !== 'charter.nearcarta.near')));
  assert.deepEqual(liveShops(['toll.nearcarta.near', 'TOLL.nearcarta.near'], RETIRED), ['toll.nearcarta.near']);
  // A list of only retired accounts becomes empty, which the page reads as "use the default".
  assert.deepEqual(liveShops(['charter.nearcarta.near'], RETIRED), []);
  assert.equal(namesRetired(saved, RETIRED), true);
  assert.equal(namesRetired(['toll.nearcarta.near'], RETIRED), false);
});
const sorted = l => [...l].sort();

test('the default shops include Guardhouse and never the retired charter', () => {
  const guard = MAIN.guard?.contract;
  assert.equal(guard, 'guard.nearcarta.near', 'Guardhouse is deployed');
  const defaults = [MAIN.toll?.contract, guard, HOUSE_SHOP].filter(Boolean);
  assert.deepEqual(defaults, ['toll.nearcarta.near', 'guard.nearcarta.near', 'house.nearcarta.near']);
  assert.equal(defaults.includes('charter.nearcarta.near'), false);
  // And that default list fits a row.
  assert.equal(callsFitRow(build(defaults), defaults.length), true);
});

test('a known shop contributes only the method its contract answers on', () => {
  assert.deepEqual(methodsForShop('toll.nearcarta.near'), ['cross']);
  assert.deepEqual(methodsForShop('guard.nearcarta.near'), ['pay']);
  assert.deepEqual(methodsForShop('house.nearcarta.near'), ['house_session_check_in', 'house_session_prepare_send']);
  // Anything we do not know keeps the caller's method: townhall, arena, wrap.near.
  assert.deepEqual(methodsForShop('townhall.nearcarta.near'), ['ft_transfer']);
  assert.deepEqual(methodsForShop('friend.near'), ['ft_transfer']);
  assert.deepEqual(Object.keys(SHOP_METHODS).sort(), ['guard.nearcarta.near', 'house.nearcarta.near', 'toll.nearcarta.near']);
});

test('the shorter list is narrower than the one that failed, and the guard blocks it', () => {
  // The failed list, with the retired charter dropped and Guardhouse added.
  const receivers = ['toll.nearcarta.near', 'wrap.near', 'arena.nearcarta.near', 'house.nearcarta.near', 'townhall.nearcarta.near', 'guard.nearcarta.near'];
  const calls = build(receivers);
  const oldStyle = receivers.map(r => ({ receiver: r, method: 'ft_transfer' })).concat(
    ['near_deposit', 'ft_transfer', 'storage_deposit'].map(m => ({ receiver: 'wrap.near', method: m })),
    [{ receiver: BOARD, method: 'stamp' }, ...HOUSE_CALLS.map(c => ({ receiver: c.receiver, method: c.method }))],
  );
  assert.ok(bytesOf(calls) < bytesOf(oldStyle), 'cross/pay are narrower than ft_transfer on Toll and Guard');
  // Still too much for one row at six receivers, so the page must refuse it.
  assert.equal(callsFitRow(calls, receivers.length), false, 'six receivers cannot hold this list');
  assert.ok(bytesOf(calls) > pairBudgetBytes(receivers.length));
});

test('a list that does not fit is shrunk to one that does, keeping the shops that need a call', () => {
  const receivers = ['toll.nearcarta.near', 'wrap.near', 'arena.nearcarta.near', 'house.nearcarta.near', 'townhall.nearcarta.near', 'guard.nearcarta.near'];
  const keep = fittingShops(receivers, build);
  assert.ok(keep.length >= 1 && keep.length < receivers.length, 'it found a smaller list');
  assert.equal(callsFitRow(build(keep), keep.length), true, 'the suggested list fits');
  // Toll, Guard and House each need their own call, so they survive a trim before a plain payee.
  assert.ok(keep.includes('toll.nearcarta.near'));
  assert.ok(keep.includes('guard.nearcarta.near'));
  assert.ok(keep.includes('house.nearcarta.near'));
  // The type order is kept among the survivors.
  const order = receivers.filter(r => keep.includes(r));
  assert.deepEqual(keep, order);
  // A list that already fits is returned unchanged.
  const small = ['toll.nearcarta.near', HOUSE_SHOP];
  assert.deepEqual(fittingShops(small, build), small);
});

test('the fail row could not hold what the page sent, and the new default can', () => {
  // Six receivers and the 11 pairs the transaction actually carried: five shop
  // ft_transfers (charter, toll, arena, house, townhall), the wrap.near trio, the board
  // stamp and the two House calls. Note house appears twice, as the tx did.
  const six = ['toll.nearcarta.near', 'wrap.near', 'arena.nearcarta.near', 'house.nearcarta.near', 'townhall.nearcarta.near', 'charter.nearcarta.near'];
  const five = ['charter.nearcarta.near', 'toll.nearcarta.near', 'arena.nearcarta.near', 'house.nearcarta.near', 'townhall.nearcarta.near'];
  const eleven = five.map(r => ({ receiver: r, method: 'ft_transfer' })).concat(
    ['near_deposit', 'ft_transfer', 'storage_deposit'].map(m => ({ receiver: 'wrap.near', method: m })),
    [{ receiver: BOARD, method: 'stamp' }, ...HOUSE_CALLS.map(c => ({ receiver: c.receiver, method: c.method }))],
  );
  assert.equal(eleven.length, 11);
  assert.equal(bytesOf(eleven), 601, 'the exact list the chain refused');
  assert.equal(callsFitRow(eleven, six.length), false, 'the chain refused exactly this');
  // The default list the page now sends: two live shops, seven pairs.
  const defaults = [MAIN.toll?.contract, HOUSE_SHOP].filter(Boolean);
  const calls = build(defaults);
  assert.ok(calls.length <= 8);
  assert.equal(callsFitRow(calls, defaults.length), true);
});

test('a stale saved list is migrated, so charter is not sent again', () => {
  // `app/house/setup.js` repairs the saved list at load instead of only filtering on read.
  const saved = ['charter.nearcarta.near', 'toll.nearcarta.near', 'wrap.near', 'arena.nearcarta.near', 'house.nearcarta.near', 'townhall.nearcarta.near'];
  const { receivers, dropped } = migrateShops(saved, RETIRED);
  assert.deepEqual(dropped, ['charter.nearcarta.near']);
  assert.equal(receivers.includes('charter.nearcarta.near'), false);
  assert.deepEqual(receivers, saved.slice(1), 'the live shops keep their order');
  // Running it twice is the same as running it once: nothing left to drop.
  assert.deepEqual(migrateShops(receivers, RETIRED), { receivers, dropped: [] });
  // A list that only named retired accounts leaves nothing, and the page falls back to the default.
  assert.deepEqual(migrateShops(['charter.nearcarta.near'], RETIRED), { receivers: [], dropped: ['charter.nearcarta.near'] });
  // No stale list, nothing to say.
  assert.deepEqual(migrateShops(null, RETIRED), { receivers: [], dropped: [] });
  assert.deepEqual(migrateShops([], RETIRED), { receivers: [], dropped: [] });
});

test('the sign step refuses an over-full row before the wallet opens', () => {
  // The Rules step already refuses; this pins the second check, because #sign is reachable
  // by URL and an open is what writes set_calls. Without it the batch spends open_charter's
  // deposit and then panics ERR_ROW_TOO_BIG, which is the 2026-11-06 failure.
  const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
  const from = src.slice(src.indexOf('async function signBoard'));
  const to = from.slice(0, from.indexOf('const w = globalThis.__NC_SETUP_WALLET'));
  assert.match(to, /callsFitRow\(callsFor\(r, contract\), r\.receivers\.length\)/);
  assert.match(to, /fittingShops\(r\.receivers/);
  // And it runs before the wallet is asked for anything.
  assert.ok(to.indexOf('callsFitRow') < to.indexOf('__NC_SETUP_WALLET'), 'the check precedes the wallet');
  // The saved list is repaired at load, before the first render.
  const paint = src.slice(src.indexOf('function paintShell'), src.indexOf('async function boot'));
  assert.match(paint, /migrateSavedShops\(\)/);
});
