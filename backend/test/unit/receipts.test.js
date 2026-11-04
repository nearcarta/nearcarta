import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { receiptsBody, RECEIPT_KEYS } from '../../../shared/rails/receipts.js';
import { makeApp } from '../../src/app.js';

const mainnet = JSON.parse(readFileSync(new URL('../../../shared/deployments/mainnet.json', import.meta.url), 'utf8'));
const budget = { usd: 0.001, calls: 2, limit_usd: 0.05, limit_calls: 300, max_tokens: 160, model: 'z-ai/glm-5.3-flash' };

test('every rail uses the same receipt keys', () => {
  const body = receiptsBody(mainnet, budget, { jobTokens: 160 });
  assert.deepEqual(body.shape, RECEIPT_KEYS);
  assert.match(body.gate, /charter contract/);
  const rails = new Set(body.receipts.map(r => r.rail));
  for (const rail of ['near', 'chain-signatures', 'intents', 'near-ai']) assert.ok(rails.has(rail), rail);
  for (const row of body.receipts) assert.deepEqual(Object.keys(row), RECEIPT_KEYS);
});

test('mainnet charter receipts link the allowed payment and the over-cap refusal', () => {
  const body = receiptsBody(mainnet, budget);
  const allowed = body.receipts.find(r => r.tx === mainnet.charter.txs['agent_propose_allowed_0.001']);
  const refused = body.receipts.find(r => r.tx === mainnet.charter.txs['agent_propose_over_cap_0.003']);
  assert.equal(allowed.decision, 'allowed');
  assert.equal(allowed.checks.within_allowance, true);
  assert.equal(allowed.url, 'https://nearblocks.io/txns/' + allowed.tx);
  assert.equal(refused.decision, 'refused');
  assert.equal(refused.reason, 'over_per_action_cap');
  assert.equal(refused.checks.within_allowance, false);
  const tollNo = body.receipts.find(r => r.tx === mainnet.toll.txs.owner_toll_pay_not_allowlisted);
  assert.equal(tollNo.rail, 'chain-signatures');
  assert.equal(tollNo.decision, 'refused');
});

test('an intents receipt has no tx, and a model job names its dollar cap', () => {
  const body = receiptsBody(mainnet, budget, { jobTokens: 160 });
  const quote = body.receipts.find(r => r.rail === 'intents');
  assert.equal(quote.decision, 'dry');
  assert.equal(quote.tx, null);
  const job = body.receipts.find(r => r.rail === 'near-ai');
  assert.equal(job.decision, 'capped');
  assert.equal(job.amount, '0.05');
  assert.equal(job.asset, 'USD');
  assert.match(job.reason, /160 tokens/);
  assert.equal(body.inference.max_tokens, 160);
  assert.equal(body.inference.limit_usd, 0.05);
});

test('GET /api/receipts serves the same shape', async () => {
  const r = await makeApp().request('/api/receipts', { headers: { 'cf-connecting-ip': '192.0.2.40' } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.receipts.length >= 4);
  for (const row of j.receipts) assert.deepEqual(Object.keys(row), j.shape);
  assert.equal(j.inference.max_tokens, 160);
});
