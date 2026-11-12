// F66: the Ferry row path. /setup writes the smallest payment as 1 yocto, so the 1 yocto a
// wrap.near ft_transfer attaches is not refused below_min_amount, and Update my rules shows the
// change on an older row. Ferry swaps need wrap.near in Allowed shops; /setup offers it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rulesDiff, showMin, signRulesUpdate } from '../../../shared/setup/rules-diff.js';
import { callPolicy, callsFitRow, dropOptionalPairs, FERRY_CALL_TARGETS, payoutsCalls } from '../../../shared/board/session.js';
import { HOUSE_CALLS } from '../../../shared/house/shop.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

const LIVE_ROW = {
  receivers: ['nearcarta.near', 'toll.nearcarta.near', 'guard.nearcarta.near', 'house.nearcarta.near', 'townhall.nearcarta.near'],
  per_action_cap: '5000000000000000000000', daily_budget: '10000000000000000000000', max_actions_per_day: 20,
  min_amount: '100000000000000000000', expires_at: '1794558972533000000',
};

test('setup writes the smallest payment as 1 yocto, never 0.0001 NEAR', () => {
  const src = read('app/house/setup.js');
  assert.match(src, /export const MIN_AMOUNT_YOCTO = '1';/);
  assert.match(src, /min_amount: MIN_AMOUNT_YOCTO/);
  assert.doesNotMatch(src, /min_amount: toY\(0\.0001\)/);
  // The contract floor: rules_from requires min_amount > 0.
  const board = read('contracts/charter_board/src/lib.rs');
  assert.match(board, /r\.min_amount\.0 > 0 && r\.min_amount\.0 <= r\.per_action_cap\.0/);
});

test('an older row with a 0.0001 minimum shows the Smallest payment change', () => {
  const local = { cap: 0.005, daily: 0.01, per: 20, receivers: LIVE_ROW.receivers, minAmount: '1' };
  const diff = rulesDiff(local, LIVE_ROW);
  assert.deepEqual(diff.map(f => f.id), ['min']);
  assert.equal(diff[0].label, 'Smallest payment');
  assert.equal(diff[0].next, '1 yocto');
  assert.equal(signRulesUpdate({ live: true, local, row: LIVE_ROW }).changed, true);
  // Already 1 yocto: nothing to update.
  assert.equal(rulesDiff(local, { ...LIVE_ROW, min_amount: '1' }).length, 0);
  // A caller that does not say what it writes is not compared (older callers keep working).
  assert.equal(rulesDiff({ ...local, minAmount: undefined }, LIVE_ROW).length, 0);
  assert.equal(showMin('1'), '1 yocto');
});

test('Ferry chip: /setup offers wrap.near and ?shop=ferry adds it once', () => {
  const src = read('app/house/setup.js');
  assert.match(src, /data-testid="rule-add-ferry"/);
  assert.match(src, /Add Ferry swaps \(wrap\.near\)/);
  assert.match(src, /data-testid="rule-ferry-on"/);
  assert.match(src, /get\('shop'\) === 'ferry'/);
  assert.match(src, /ferryAutoDone = true/);
  // Not a default shop: listing it is a choice the visitor makes.
  const defaults = src.slice(src.indexOf('const DEFAULT_SHOPS'), src.indexOf('\n', src.indexOf('const DEFAULT_SHOPS')));
  assert.doesNotMatch(defaults, /wrap\.near/);
});

test('the live five-shop row plus wrap.near still fits, with the same 17 call pairs', () => {
  const rec = [...LIVE_ROW.receivers, 'wrap.near'];
  const cap = LIVE_ROW.per_action_cap;
  const extra = [...FERRY_CALL_TARGETS, { receiver: 'board.nearcarta.near', method: 'stamp', cap }, ...HOUSE_CALLS];
  const full = callPolicy(rec, cap, '20000000000000000000000', 'ft_transfer', payoutsCalls(extra, cap).calls).calls;
  const d = dropOptionalPairs(full, rec.length);
  assert.equal(d.fits, true);
  assert.equal(d.calls.length, 17, 'wrap.near as a payee is the same ft_transfer pair the trio already has');
  assert.ok(callsFitRow(d.calls, rec.length));
  const wraps = d.calls.filter(c => c.receiver === 'wrap.near').map(c => c.method).sort();
  assert.deepEqual(wraps, ['ft_transfer', 'near_deposit', 'storage_deposit']);
});
