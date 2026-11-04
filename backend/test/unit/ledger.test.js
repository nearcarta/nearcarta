import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger } from '../../src/ledger.js';

const ev = d => ({ standard: 'oath', event: 'action', data: [d] });
test('ledger lists payouts, refusals, Base payouts and inference with totals', () => {
  const L = buildLedger({ now: 'N',
    chronicle: { txs: [
      { hash: 'A', at: '2026-11-02T10:00:00Z', events: [ev({ shop: 'pay', decision: 'allowed', receiver: 'cafe.testnet', amount: '10000000000000000000000' })] },
      { hash: 'B', at: '2026-11-02T11:00:00Z', events: [ev({ shop: 'arena', decision: 'denied', reason: 'receiver_not_allowlisted', receiver: 'evil.testnet', amount: '5' })] },
      { hash: 'C', error: 'rpc 429' }] },
    toll: { recent: [{ to: '0xabc', value: '10000000000000', nonce: 0, status: 'confirmed' }] },
    budget: { day: '2026-11-02', usd: 0.000062, calls: 1, model: 'z-ai/glm-5.3-flash' } });
  assert.equal(L.totals.payouts_near, 0.01);
  assert.equal(L.totals.refusals, 1);
  assert.equal(L.totals.payouts_base_eth, 0.00001);
  assert.equal(L.totals.inference_usd_today, 0.000062);
  assert.equal(L.partial, true); // one tx could not be read: say so
  assert.equal(L.rows[0].tx, 'B'); // newest first
  assert.equal(L.rows.find(r => r.tx === 'B').note, 'receiver_not_allowlisted');
});
test('empty inputs give an empty, honest ledger', () => {
  const L = buildLedger({});
  assert.deepEqual(L.rows, []); assert.equal(L.partial, false); assert.equal(L.totals.payouts_near, 0);
});

test('ledger: a cached feed is complete, a busy feed is partial', async () => {
  const b = buildLedger;
  const ok = b({ chronicle: { stale: true, txs: [] } });
  if (ok.partial !== false || ok.cached !== true) throw new Error('stale must not be partial');
  const bad = b({ chronicle: { busy: true, txs: [] } });
  if (bad.partial !== true || bad.partial_reason !== 'feed busy') throw new Error('busy must be partial');
});

test('ledger: toll gate visits are sale rows and count toward sales', () => {
  const gate = { gate: 'g.testnet', policy: { next_nonce: 3, gate: { fee: '10000000000000000000000', payee: 'cafe.testnet' } },
    recent: [{ nonce: 2, status: 'signed', tx_hash: '0xab', explorer: 'https://x', visit: { by: 'v.testnet' } }] };
  const L = buildLedger({ chronicle: { txs: [] }, gate });
  const r = L.rows.find(x => x.shop === 'Toll Bridge');
  assert.equal(r.kind, 'sale'); assert.equal(r.amount, '0.01');
  assert.equal(L.totals.sales_near, 0.01); assert.equal(L.totals.gate_visits_total, 3); assert.equal(L.totals.gate_sales_near_total, 0.03);
});
