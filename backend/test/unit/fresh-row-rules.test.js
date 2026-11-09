import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRules } from '../../scripts/board-fresh-row.js';

const ok = { receivers: ['t.near'], per_action_cap: '100', daily_budget: '500', max_actions_per_day: 8, window_start_min: 0, window_end_min: 0, min_amount: '1', expires_at: '0' };
const calls = [{ receiver: 't.near', method: 'bid', cap: '10' }];

test('the fresh-row rules match what the board accepts', () => {
  assert.deepEqual(checkRules(ok, calls), []);
});
test('window 1440, min_amount 0 and tuple calls are refused before any NEAR moves', () => {
  assert.match(checkRules({ ...ok, window_end_min: 1440 }, calls).join(), /ERR_WINDOW/);
  assert.match(checkRules({ ...ok, min_amount: '0' }, calls).join(), /ERR_MIN/);
  assert.match(checkRules({ ...ok, min_amount: '101' }, calls).join(), /ERR_MIN/);
  assert.match(checkRules(ok, [['t.near', 'bid', '10']]).join(), /ERR_ARGS/);
});
