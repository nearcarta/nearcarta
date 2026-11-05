import test from 'node:test';
import assert from 'node:assert/strict';
import { chronicle, _resetFeeds, _setSnapshots } from '../../src/shops.js';
test('cold feed failure with no cache answers the deploy snapshot, marked stale', async () => {
  _resetFeeds();
  _setSnapshots({ at: new Date(Date.now() - 60_000).toISOString(), feeds: { 'a.near': { account: 'a.near', txs: [{ hash: 'h1' }, { hash: 'h2' }] } } });
  const v = await chronicle('a.near', 1, async () => { throw new Error('tx index 429'); });
  assert.equal(v.stale, true); assert.equal(v.snapshot, true); assert.equal(v.count, 1); assert.ok(v.stale_age_s >= 59);
  await assert.rejects(chronicle('b.near', 1, async () => { throw new Error('tx index 429'); }));
  _setSnapshots(undefined);
});
