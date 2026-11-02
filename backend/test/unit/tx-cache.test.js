import { test } from 'node:test';
import assert from 'node:assert/strict';
import { txStatus } from '../../src/near.js';
test('a final tx is read from RPC once, then served from memory', async () => {
  let n = 0; const call = async () => { n++; return { status: { SuccessValue: '' }, final_execution_status: 'FINAL' }; };
  await txStatus('H1', 's.testnet', call); await txStatus('H1', 's.testnet', call);
  assert.equal(n, 1);
});
test('an error is not cached', async () => {
  let n = 0; const call = async () => { n++; throw new Error('rpc http 429'); };
  await assert.rejects(txStatus('H2', 's', call)); await assert.rejects(txStatus('H2', 's', call));
  assert.equal(n, 4); // archival, then the normal pool, on each call
});
test('tx status asks the archival node first', async () => {
  const urls = []; const call = async (m, p, u) => { urls.push(u); return { status: {}, final_execution_status: 'FINAL' }; };
  await txStatus('H3', 's', call);
  assert.match(String(urls[0]), /archival/);
});
