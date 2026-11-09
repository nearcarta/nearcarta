import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quote } from '../../../shared/market/pricing.js';
import { whyLines, whyHtml, factorText, yoctoToNear } from '../../../app/src/market/why.js';

const cases = JSON.parse(readFileSync(new URL('../../../shared/market/pricing-cases.json', import.meta.url)));
const at = (over = {}) => ({ base: '2000000000000000000000', stock: 20, target_stock: 20, buys_last_hour: 0, sells_last_hour: 0, till: '10', floor: '1', ...over });

test('js and rust pricing agree on every golden case', () => {
  assert.ok(cases.length >= 8);
  for (const c of cases) {
    const q = quote(c.market);
    assert.equal(q.buy, c.buy, c.name);
    assert.equal(q.sell, c.sell, c.name);
    assert.deepEqual(q.reasons.map((r) => r.factor_bps), c.factors, c.name);
  }
});

test('flooding a shop with iron lowers the iron price', () => {
  const before = BigInt(quote(at()).buy);
  const after = BigInt(quote(at({ stock: 60, sells_last_hour: 10 })).buy);
  assert.ok(after * 4n < before);
});

test('the tooltip shows the quote reasons word for word', () => {
  const q = quote(at({ stock: 40, buys_last_hour: 2, sells_last_hour: 6 }));
  assert.deepEqual(whyLines(q), [
    'scarcity ×0.5: 40 in stock, target 20',
    'demand ×0.8: 2 bought, 6 sold in the last hour',
    'mood ×1: till above floor',
  ]);
  const html = whyHtml(q, 'iron');
  for (const r of q.reasons) assert.ok(html.includes(r.why));
  assert.ok(html.includes('You pay 0.0008 NEAR for iron'));
});

test('the tooltip escapes a good name and formats factors and amounts', () => {
  assert.ok(!whyHtml(quote(at()), '<img src=x>').includes('<img'));
  assert.equal(factorText(3333), '×0.33');
  assert.equal(factorText(40000), '×4');
  assert.equal(yoctoToNear('1500000000000000000000000'), '1.5');
  assert.equal(yoctoToNear('0'), '0');
});
