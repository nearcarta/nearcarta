// The panel's balance read needs a token's NEP-141 id. This walks the same path the panel walks,
// one function at a time, and pins where `assetId` must still be present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToken, tokenChoices } from '../../../app/src/ferry-catalog.js';

// Exactly what the API returns for a token (GET /api/ferry/tokens).
const API_ROWS = [
  { assetId: 'nep141:wrap.near', symbol: 'wNEAR', chain: 'near', decimals: 24, price: 3.59 },
  { assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', symbol: 'USDC', chain: 'near', decimals: 6, price: 0.99 },
];

test('normalizeToken keeps the NEP-141 id', () => {
  const t = normalizeToken(API_ROWS[0]);
  assert.equal(t.symbol, 'wNEAR');
  assert.equal(t.assetId, 'nep141:wrap.near', 'the balance read cannot find its contract without this');
});

test('tokenChoices keeps the NEP-141 id on every choice', () => {
  const choices = tokenChoices(API_ROWS);
  assert.equal(choices.length, 2);
  for (const c of choices) {
    assert.ok(String(c.assetId).startsWith('nep141:'), `${c.symbol} lost its assetId in the catalogue`);
  }
  const usdc = choices.find(c => c.id === 'USDC|near');
  assert.equal(usdc.assetId, API_ROWS[1].assetId);
});

test('a row that already went through the catalogue is not emptied by a second pass', () => {
  // The panel calls tokenChoices() again on rows it got from a hook. If those rows were already
  // normalized, a second pass must not drop the id — that is the shape of the bug.
  const once = tokenChoices(API_ROWS);
  const twice = tokenChoices(once);
  const wnear = twice.find(c => c.id === 'wNEAR|near');
  assert.equal(wnear.assetId, 'nep141:wrap.near', 'a second normalisation dropped the id');
});
