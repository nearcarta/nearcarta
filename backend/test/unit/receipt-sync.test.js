import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const r = p => readFileSync(new URL(p, import.meta.url), 'utf8');
test('browser receipt.js is the same file as shared/vault/receipt.js', () => {
  assert.equal(r('../../../app/design/D8_shops/js/receipt.js'), r('../../../shared/vault/receipt.js'));
});
test('arena run shows a receipt and a counter-offer slot', () => {
  const s = r('../../../app/design/D8_shops/js/shopui.js');
  assert.match(s, /data-testid="receipt"/); assert.match(s, /data-testid="counter-offer"/);
});
