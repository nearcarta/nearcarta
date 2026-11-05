import { test } from 'node:test';
import assert from 'node:assert/strict';
import { txStatus } from '../../src/near.js';
test('a final tx is read from RPC once, then served from memory', async () => {
  let n = 0; const call = async () => { n++; return { status: { SuccessValue: '' }, final_execution_status: 'FINAL' }; };
  await txStatus('H1', 's.near', call); await txStatus('H1', 's.near', call);
  assert.equal(n, 1);
});
test('an error is not cached', async () => {
  txStatus.backoffMs = 0; let n = 0; const call = async () => { n++; throw new Error('rpc http 429'); };
  await assert.rejects(txStatus('H2', 's', call)); await assert.rejects(txStatus('H2', 's', call));
  assert.equal(n, 18); // 3 rounds of two archival nodes then pool, on each call
});
test('tx status asks the archival node first', async () => {
  const urls = []; const call = async (m, p, u) => { urls.push(u); return { status: {}, final_execution_status: 'FINAL' }; };
  await txStatus('H3', 's', call);
  assert.match(String(urls[0]), /archival/);
});
test('a 429 is retried after a back-off and then succeeds', async () => {
  txStatus.backoffMs = 0; let n = 0;
  const call = async () => { if (++n <= 3) throw new Error('rpc http 429'); return { status: {}, final_execution_status: 'FINAL' }; };
  const v = await txStatus('H4', 's', call); assert.ok(v.status); assert.equal(n, 4);
});
