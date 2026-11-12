// F23/F24 (film 2026-11-12): the page moves on by itself after the wallet confirms the row, and a
// minute of expiry drift is not a rules difference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rulesDiff, expiryChange, sameExpiry, EXPIRY_DRIFT_MS } from '../../../shared/setup/rules-diff.js';

const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
const MIN = 60_000_000_000n; // one minute in ns
const base = 1794300000000000000n;

test('F24: expiries a minute apart are the same rule; ten minutes apart are not', () => {
  assert.equal(EXPIRY_DRIFT_MS, 5 * 60 * 1000);
  assert.equal(sameExpiry(String(base), String(base + MIN)), true);
  assert.equal(expiryChange(String(base), String(base + MIN)), null);
  assert.ok(expiryChange(String(base), String(base + 10n * MIN)));
  assert.equal(sameExpiry('0', String(base)), false);
  const row = { per_action_cap: '1000000000000000000000', daily_budget: '3000000000000000000000', max_actions_per_day: 3, receivers: ['a.near'], expires_at: String(base) };
  const local = { cap: 0.001, daily: 0.003, per: 3, receivers: ['a.near'], expiresAt: String(base - MIN) };
  assert.deepEqual(rulesDiff(local, row), []);
});

test('F23: the row the poll finds is adopted into chainRow and the page repaints', () => {
  const adopt = src.slice(src.indexOf('function adoptRow'), src.indexOf('async function signBoard'));
  assert.match(adopt, /chainRow = row; chainLoadedFor = me; chainRead = true/);
  assert.match(adopt, /pollRowLate/);
  const sign = src.slice(src.indexOf('async function signBoard'), src.indexOf('function noteSign'));
  assert.match(sign, /const opened = await pollRow\(readRpc, contract\)/);
  assert.match(sign, /if \(!failure\) pollRowLate\(readRpc, contract\)/);
  assert.match(sign, /st\.hoursEdited = false/);
  assert.match(sign, /done\(5\); await refreshBal\(\);\n  render\(\);/);
});
