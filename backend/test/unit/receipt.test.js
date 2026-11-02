import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receipt, counterOffer, near } from '../../../shared/vault/receipt.js';

const clause = { asset: 'Native', receivers: ['cafe.x.testnet'], per_action_cap: '50000000000000000000000' }; // 0.05
test('near() formats yocto', () => { assert.equal(near('50000000000000000000000'), '0.05'); assert.equal(near('2000000000000000000000000'), '2'); });

test('allowed action: receipt lists what, to, price, checks; no counter-offer', () => {
  const r = receipt({ note: 'coffee', receiver: 'cafe.x.testnet', amount: '10000000000000000000000', by: 'model', model: 'z-ai/glm-5.3-flash',
    verification: { verified: true }, cost: { usd: 0.0002 }, decision: 'allowed', tx: 'T', clause_id: 'pay' }, clause);
  assert.equal(r.what, 'coffee'); assert.equal(r.price_near, '0.01'); assert.equal(r.checks.within_plan, true);
  assert.equal(r.checks.model_reply_verified, true); assert.equal(r.checks.charter, 'allowed'); assert.equal(r.counter_offer, null);
});

test('over plan to an allowlisted receiver: exactly one counter-offer at the cap, with reasoning', () => {
  const r = receipt({ receiver: 'cafe.x.testnet', amount: '200000000000000000000000', by: 'fallback', decision: 'denied', reason: 'over_per_action_cap' }, clause);
  assert.equal(r.checks.within_plan, false);
  assert.equal(r.counter_offer.amount, clause.per_action_cap);
  assert.match(r.counter_offer.why, /0\.2 NEAR.*at most 0\.05 NEAR/);
  assert.equal(r.decided_by, 'rule parser (no model)');
});

test('no counter-offer to a stranger, under cap, or with no clause', () => {
  assert.equal(counterOffer({ receiver: 'evil.testnet', amount: '9'.repeat(25) }, clause), null);
  assert.equal(counterOffer({ receiver: 'cafe.x.testnet', amount: '1' }, clause), null);
  assert.equal(counterOffer({ receiver: 'cafe.x.testnet', amount: '9'.repeat(25) }, undefined), null);
});
