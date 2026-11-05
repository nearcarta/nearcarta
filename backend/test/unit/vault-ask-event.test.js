import test from 'node:test';
import assert from 'node:assert/strict';
import { askEvent } from '../../src/vault.js';

const ev = { standard: 'oath', version: '2.0.0', event: 'action', data: [{ decision: 'denied', reason: 'over_per_action_cap' }] };
const tx = failed => ({ transaction_outcome: { id: 't', outcome: { logs: [], status: {} } },
  receipts_outcome: [{ id: 'r', outcome: { executor_id: 'c.near', logs: ['EVENT_JSON:' + JSON.stringify(ev)], status: failed ? { Failure: {} } : { SuccessValue: '' } } }] });

test('askEvent returns the charter action event from the tx', async () => {
  const e = await askEvent(async () => tx(false), 'h', 'c.near');
  assert.equal(e.data[0].reason, 'over_per_action_cap'); assert.equal(e.executor, 'c.near');
});
test('askEvent ignores a phantom event from a failed receipt', async () => {
  assert.equal(await askEvent(async () => tx(true), 'h', 'c.near'), null);
});
