import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b58hex, validDepositAddress, tidepoolStatus, tidepoolVerifierOk, TIDEPOOL } from '../../src/ferry.js';

test('b58hex decodes the Tidepool verifier code hash to the defuse v0.4.2 sha256', () => {
  assert.equal(b58hex('HbE8V9BHDxAA295mzvMyJ6uDq95iqpekZ4AiXnFwBDnL'), TIDEPOOL.verifierSha256);
  assert.equal(b58hex('11111111111111111111111111111111'), '0'.repeat(64));
});
test('verifier check fails closed on a different code hash', async () => {
  const v = await tidepoolVerifierOk(async () => ({ code_hash: '11111111111111111111111111111111' }));
  assert.equal(v.ok, false);
});
test('deposit address validation', () => {
  assert.ok(validDepositAddress('452122de2cfae50b6a09af025951edd3e52610f55cf165458db11d1804c4b87c'));
  assert.ok(validDepositAddress('0x2010fa71347b99f4a42dce85c0a697b7f6fdb036'));
  for (const a of ['bad addr!', '', null, 'x'.repeat(200), '../v0/faucet']) assert.equal(validDepositAddress(a), false);
});
const ok = async () => ({ ok: true });
const res = (status, body) => ({ status, ok: status < 400, json: async () => body });
test('tracker reports a partial-deposit refund with amount and reason', async () => {
  const s = await tidepoolStatus('a'.repeat(64), async () => res(200, { status: 'REFUNDED', updatedAt: 't',
    swapDetails: { depositedAmountFormatted: '1', refundedAmount: '1000000', refundedAmountFormatted: '1', refundReason: 'PARTIAL_DEPOSIT', nearTxHashes: ['H'] } }), ok);
  assert.equal(s.label, 'community testnet, not 1Click');
  assert.equal(s.final, true);
  assert.deepEqual(s.refund, { amount: '1000000', formatted: '1', reason: 'PARTIAL_DEPOSIT' });
  assert.equal(s.near_txs[0].explorer, 'https://testnet.nearblocks.io/txns/H');
});
test('tracker: pending is not final, no refund; unknown address is 404; bad address is 400 before any fetch', async () => {
  const s = await tidepoolStatus('b'.repeat(64), async () => res(200, { status: 'INCOMPLETE_DEPOSIT', swapDetails: { refundedAmount: '0' } }), ok);
  assert.equal(s.final, false); assert.equal(s.refund, null);
  await assert.rejects(tidepoolStatus('c'.repeat(64), async () => res(404, {}), ok), e => e.status === 404);
  let called = false;
  await assert.rejects(tidepoolStatus('nope nope', async () => { called = true; }, ok), e => e.status === 400);
  assert.equal(called, false);
});
