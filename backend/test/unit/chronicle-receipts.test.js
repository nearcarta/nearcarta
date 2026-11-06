// Cross-shop receipts and totals: one row per real hash, three categories, cross-chain legs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptsOf, totalsOf, totalsLine, amountOf, categoryOf, legsOf, tokenDecimals } from '../../../shared/chronicle/receipts.js';

const H1 = '8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR';
const H2 = 'CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF';
const H3 = 'HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw';

test('the same hash reported by two shops is one receipt', () => {
  const rows = [
    { shop: 'toll', decision: 'allowed', h: H1 },
    { shop: 'board', decision: 'allowed', h: H1 },
  ];
  const out = receiptsOf(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].shop, 'toll', 'the first shop that reported it wins');
});

test('a row with no hash is not a receipt, and a dry quote is labelled', () => {
  assert.equal(receiptsOf([{ shop: 'ferry', decision: 'allowed' }]).length, 0);
  const out = receiptsOf([{ shop: 'ferry', decision: 'allowed', h: H3, dry: true }]);
  assert.equal(out[0].dry, true);
  const t = totalsOf([{ shop: 'ferry', decision: 'allowed', h: H3, dry: true }]);
  assert.equal(t.totals.dry, 1);
  assert.equal(t.totals.delivered, 0, 'a dry quote is not a delivery');
  assert.equal(t.totals.attempted, 0);
});

test('a failed on-chain row is attempted, not delivered', () => {
  assert.equal(categoryOf({ decision: 'failed' }), 'attempted');
  assert.equal(categoryOf({ decision: 'denied' }), 'attempted');
  assert.equal(categoryOf({ decision: 'allowed' }), 'delivered');
  assert.equal(categoryOf({ decision: 'allowed', reason: 'refund issued' }), 'refunded');
});

test('amounts come from the token decimals, not from a rounded float', () => {
  // Aurora's real yocto deposit: 1.25e21 yocto is 0.00125 NEAR.
  assert.equal(amountOf({ raw: '1250000000000000000000', symbol: 'NEAR' }).text, '0.00125 NEAR');
  // A USDC FT delta of -297 with 6 decimals is 0.000297 USDC.
  assert.equal(amountOf({ raw: '-297', symbol: 'USDC', decimals: 6 }).text, '-0.000297 USDC');
  // The token's own decimals win over the symbol table when the index supplies them.
  assert.equal(amountOf({ raw: '10000', symbol: 'cheems', decimals: 16 }).text, '0.000000000001 cheems');
  assert.equal(tokenDecimals('GP'), 0);
  assert.equal(tokenDecimals('NEAR'), 24);
  assert.equal(tokenDecimals('unknown'), null);
});

test('totals are per shop and per token, and a cross-chain row lists its legs', () => {
  const rows = [
    { shop: 'toll', decision: 'allowed', h: H1, raw: '1000000000000000000000', symbol: 'NEAR' },
    { shop: 'board', decision: 'denied', h: H2, reason: 'over_per_action_cap' },
    {
      shop: 'ferry', decision: 'allowed', h: H3, raw: '45', symbol: 'wNEAR',
      legs: [{ chain: 'NEAR Intents', kind: 'intents', tx: 'A'.repeat(44) }],
    },
    { shop: 'toll', decision: 'denied', h: 'B'.repeat(44), reason: 'receiver_not_allowlisted' },
  ];
  const t = totalsOf(rows);
  assert.equal(t.totals.delivered, 2);
  assert.equal(t.totals.attempted, 2);
  assert.equal(t.totals.refunded, 0);
  assert.equal(t.shops.toll.delivered, 1);
  assert.equal(t.shops.toll.attempted, 1);
  assert.equal(t.shops.ferry.delivered, 1);
  assert.equal(t.tokens.NEAR.value, 0.001);
  assert.equal(t.chain.NEAR, 4, 'every row has a near leg');
  assert.equal(t.chain['NEAR Intents'], 1, 'the intents leg is counted once');
  const ferry = t.receipts.find(r => r.shop === 'ferry');
  assert.equal(ferry.legs.length, 2);
  assert.equal(ferry.legs.find(l => l.kind === 'intents').foreign, true);
  assert.match(totalsLine(t), /Delivered 2\. Refunded 0\. Attempted 2\./);
  assert.match(totalsLine(t), /Shops: board, ferry, toll\./);
});

test('a foreign leg with no tx is not invented', () => {
  assert.deepEqual(legsOf({ h: H1, chain: 'NEAR' }).map(l => l.kind), ['near']);
  assert.equal(legsOf({ h: H1, legs: [{ chain: 'Base', kind: 'foreign' }] }).length, 1);
  assert.equal(legsOf({ h: H1, foreign: { chain: 'Base' } }).length, 1);
});
