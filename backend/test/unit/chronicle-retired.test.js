import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hideRetired, RETIRED_TX_SHA256 } from '../../src/shops.js';

test('a feed with no retired tx comes back unchanged', () => {
  const feed = { account: 'a.testnet', count: 2, txs: [{ hash: 'keep1' }, { hash: 'keep2' }] };
  assert.equal(hideRetired(feed), feed);
  assert.equal(hideRetired(null), null);
  assert.equal(RETIRED_TX_SHA256.size, 1);
  assert.doesNotMatch(readFileSync(new URL('../../src/shops.js', import.meta.url), 'utf8'), /5HG5SPJ5/); // listed by sha256 only
});
test('a retired tx is left out and counted', () => {
  const h = createHash('sha256').update('retired-test-hash').digest('hex');
  RETIRED_TX_SHA256.add(h);
  try {
    const f = hideRetired({ count: 3, txs: [{ hash: 'a' }, { hash: 'retired-test-hash' }, { hash: 'b' }] });
    assert.deepEqual(f.txs.map(t => t.hash), ['a', 'b']);
    assert.equal(f.count, 2); assert.equal(f.retired_hidden, 1);
  } finally { RETIRED_TX_SHA256.delete(h); }
});
