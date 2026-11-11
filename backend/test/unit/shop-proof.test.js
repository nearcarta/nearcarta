// "What the chain saw": the same six facts in the same order in every shop, and never a made-up value.
// Docs: https://docs.near.org/protocol/transactions · https://docs.near.org/api/rpc/transactions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proofMarkup, FIELDS, hasProof } from '../../../app/src/shop-proof.js';

test('the card shows the six facts a judge checks, in the same order everywhere', () => {
  assert.deepEqual(FIELDS.map(([k]) => k), ['contract', 'method', 'signer', 'gas', 'amount', 'decision']);
  const html = proofMarkup({ contract: 'board.nearcarta.testnet', method: 'anchor', signer: 'x.play.nearcarta.testnet', gas: '0.00036 NEAR', amount: '0.005 NEAR', decision: 'refused', tx: 'H1', net: 'testnet' });
  for (const [, label] of FIELDS) assert.ok(html.includes(label), label);
});

test('an absent field says so in words instead of inventing a value', () => {
  const html = proofMarkup({ method: 'gather', tx: 'H2' });
  // Four of the six have nothing to show, and each says that.
  assert.equal((html.match(/not in this step/g) || []).length >= 4, true);
  assert.doesNotMatch(html, /0 NEAR|0 gas/);
});

test('a step with no transaction says nothing was signed, not an empty card', () => {
  const html = proofMarkup({ method: 'gather' });
  assert.match(html, /No transaction in this step\. Nothing was signed\./);
  assert.doesNotMatch(html, /href="[^"]*txns/);
});

test('a refused step links its failed receipt and says it failed by design', () => {
  const html = proofMarkup({ contract: 'board.nearcarta.testnet', method: 'propose_call_as', decision: 'refused', tx: 'H3', net: 'testnet' });
  assert.match(html, /data-testid="proof-verdict">refused/);
  assert.match(html, /https:\/\/testnet\.nearblocks\.io\/txns\/H3/);
  assert.match(html, /this one failed on chain, by design/);
});

test('a recorded mainnet proof keeps nearblocks.io and is labelled', () => {
  const html = proofMarkup({ contract: 'board.nearcarta.near', method: 'propose', decision: 'allowed', tx: 'H4', recorded: true, net: 'testnet' });
  assert.match(html, /data-net="mainnet"/);
  assert.match(html, /Recorded on mainnet/);
  assert.match(html, /https:\/\/nearblocks\.io\/txns\/H4/);
  assert.doesNotMatch(html, /testnet\.nearblocks\.io\/txns/);
});

test('a verified TEE signature is shown with its algorand and a re-check link', () => {
  const html = proofMarkup({ method: 'anchor', tx: 'H5', tee: { verified: true, signing_algo: 'ed25519', signing_address: 'abcdef0123456789', verify_url: 'https://cloud.near.ai/verify?x' } });
  assert.match(html, /TEE signature checked/);
  assert.match(html, /ed25519/);
  assert.match(html, /re-check ↗/);
  // An unchecked one says so, and a step with no model says it used no model.
  assert.match(proofMarkup({ method: 'x', tee: { checked: false } }), /TEE signature not checked/);
  assert.match(proofMarkup({ method: 'x', tee: { checked: false } }), /this step used no model/);
});

test('hasProof needs a transaction or a method, not a shape', () => {
  assert.equal(hasProof({ tx: 'H' }), true);
  assert.equal(hasProof({ method: 'anchor' }), true);
  assert.equal(hasProof({}), false);
  assert.equal(hasProof(null), false);
});
