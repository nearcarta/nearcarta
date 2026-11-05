// C3 payouts: the browser's batch plan and answer reader (app/design/D8_shops/js/payouts.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBatch, readBatch, leftToday, batchGasTgas, toYocto, MAX_BATCH } from '../../../app/design/D8_shops/js/payouts.js';

const payees = ['cafe.near', 'books.near', 'me.near'];
const base = { payees, nonce: '7', policy: 3, nowMs: 1_000 };
const rows = [{ to: 'cafe.near', amt: 0.01 }, { to: 'books.near', amt: '0.02' }, { to: 'me.near', amt: 0.005 }];

test('plan: sequential nonces from the charter, one clause, exact amounts, memo i/n', () => {
  const p = planBatch(rows, base);
  assert.equal(p.n, 3); assert.equal(p.total, 0.035); assert.equal(p.gasTgas, 120);
  assert.deepEqual(p.ps.map(x => x.nonce), ['7', '8', '9']);
  assert.deepEqual(p.ps.map(x => x.amount), ['10000000000000000000000', '20000000000000000000000', '5000000000000000000000']);
  assert.deepEqual(p.ps.map(x => x.memo), ['payouts:1/3', 'payouts:2/3', 'payouts:3/3']);
  for (const x of p.ps) { assert.equal(x.clause_id, 'pay'); assert.equal(x.shop, 'payouts'); assert.equal(x.policy_version, 3); assert.equal(x.receipt, null); assert.equal(x.expires_at, String((1_000n + 600_000n) * 1_000_000n)); }
});
test('plan: rows without a payee are dropped, sizes 2..5 only', () => {
  assert.equal(planBatch([...rows, { to: '', amt: 1 }], base).n, 3);
  assert.throws(() => planBatch([rows[0]], base), /at least 2/);
  assert.throws(() => planBatch([], base), /at least 2/);
  assert.throws(() => planBatch(null, base), /at least 2/);
  assert.equal(planBatch(Array(MAX_BATCH).fill(rows[0]), base).n, 5);
  assert.throws(() => planBatch(Array(MAX_BATCH + 1).fill(rows[0]), base), /at most 5/);
});
test('plan: refuses zero, negative or missing amounts and accounts the rules do not allow', () => {
  assert.throws(() => planBatch([rows[0], { to: 'cafe.near', amt: 0 }], base), /above 0/);
  assert.throws(() => planBatch([rows[0], { to: 'cafe.near', amt: -1 }], base), /above 0/);
  assert.throws(() => planBatch([rows[0], { to: 'cafe.near' }], base), /above 0/);
  assert.throws(() => planBatch([rows[0], { to: 'stranger.near', amt: 0.01 }], base), /rules allow/);
});
test('gas: 30 Tgas per item plus 30, capped at 300; always >= 25 per item', () => {
  assert.equal(batchGasTgas(2), 90); assert.equal(batchGasTgas(5), 180); assert.equal(batchGasTgas(20), 300);
  for (let n = 2; n <= MAX_BATCH; n++) assert.ok(batchGasTgas(n) >= 25 * n);
});
test('toYocto rounds to 1e-6 NEAR', () => { assert.equal(toYocto(0.05), '50000000000000000000000'); assert.equal(toYocto('1'), '1000000000000000000000000'); assert.equal(toYocto(0.0000004), '0'); });
test('read: all allowed is paid, with action ids', () => {
  const r = readBatch([{ decision: 'allowed', reason: 'ok', action_id: '4' }, { decision: 'allowed', reason: 'ok', action_id: '5' }], 2);
  assert.deepEqual(r, { decision: 'allowed', reason: 'ok', paid: 2, bad: null, ids: ['4', '5'] });
});
test('read: a batch-wide refusal names the reason, no bad item', () => {
  const r = readBatch(Array(3).fill({ decision: 'denied', reason: 'over_daily_budget' }), 3);
  assert.deepEqual(r, { decision: 'denied', reason: 'over_daily_budget', paid: 0, bad: null, ids: [] });
});
test('read: one bad item refuses the rest as batch_refused', () => {
  const r = readBatch([{ decision: 'denied', reason: 'batch_refused' }, { decision: 'denied', reason: 'over_per_action_cap' }, { decision: 'denied', reason: 'batch_refused' }], 3);
  assert.deepEqual(r, { decision: 'denied', reason: 'over_per_action_cap', paid: 0, bad: 1, ids: [] });
  assert.equal(readBatch([{ decision: 'denied', reason: 'batch_refused' }, { decision: 'denied', reason: 'batch_refused' }], 2).reason, 'batch_refused');
});
test('read: a mixed or short answer is never shown as paid', () => {
  assert.equal(readBatch([{ decision: 'allowed' }, { decision: 'denied', reason: 'x' }], 2).decision, 'denied');
  assert.equal(readBatch([{ decision: 'allowed' }], 2).decision, 'failed');
  assert.equal(readBatch(null, 2).decision, 'failed'); assert.equal(readBatch('x', 2).paid, 0);
});
test('left today: budget minus spent and reserved, never below 0', () => {
  const c = { daily_budget: toYocto(0.2) };
  assert.equal(leftToday(c, { spent: toYocto(0.03), reserved: toYocto(0.01) }), 0.16);
  assert.equal(leftToday(c, null), 0.2); assert.equal(leftToday(c, { spent: toYocto(0.3) }), 0); assert.equal(leftToday(null, {}), 0);
  assert.equal(leftToday(c, { spent: toYocto(0.2) }), 0);
});
