import test from 'node:test';
import assert from 'node:assert/strict';
import { explain, replayPlan, KNOWN } from '../../../app/design/D8_shops/js/why.js';
import { CORE_TXS, CLAUSES } from '../../../app/design/D6_dashboards/src/data.js';

test('every refusal code in the real run has a plain explanation', () => {
  const codes = [...new Set(CORE_TXS.filter(t => t.reason).map(t => t.reason))];
  assert.deepEqual(codes.sort(), ['over_per_action_cap', 'receiver_not_allowlisted']);
  for (const c of codes) assert.ok(KNOWN.includes(c), `no explanation for ${c}`);
});

test('explanations carry the numbers the contract compared', () => {
  const p2 = CORE_TXS.find(t => t.id === 'P2');
  const e = explain(p2, CLAUSES);
  assert.equal(e.rule, 'Per-action cap');
  assert.match(e.plain, /0\.003 NEAR/); assert.match(e.plain, /0\.002 NEAR/);
  assert.match(explain(CORE_TXS.find(t => t.id === 'P5'), CLAUSES).plain, /nearcarta\.near/);
  assert.equal(explain({ reason: 'made_up' }, CLAUSES).known, false);
});

test('replay keeps order and squeezes time by the speed', () => {
  const acts = CORE_TXS.filter(t => t.kind === 'action');
  const p1 = replayPlan(acts, 1), p8 = replayPlan(acts, 8);
  assert.equal(p1.length, acts.filter(a => Number.isFinite(a.t)).length);
  for (let i = 1; i < p1.length; i++) assert.ok(p1[i].at >= p1[i - 1].at && p1[i].act.t >= p1[i - 1].act.t);
  assert.ok(Math.abs(p8.at(-1).at - p1.at(-1).at / 8) <= p1.length);
  assert.ok(p1.at(-1).at <= 30000 * p1.length, 'idle gaps are capped');
});
