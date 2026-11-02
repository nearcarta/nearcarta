import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../../scripts/sample-run.mjs';
test('fictional sample: honest invoices pass, the urgent and swapped-payee ones are refused', () => {
  const r = run();
  assert.deepEqual(r.invoices.map(i => i.decision), ['allowed', 'allowed', 'over_per_action_cap', 'receiver_not_allowlisted']);
  assert.ok(r.invoices[2].receipt.counter_offer, 'over-cap invoice gets a counter-offer');
});
test('fictional sample: each of the six attacks is stopped by the rule it targets', () => {
  for (const a of run().attacks) assert.equal(a.got, a.expects, a.id);
});
