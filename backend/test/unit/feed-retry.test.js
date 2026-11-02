import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chronicle } from '../../src/shops.js';

test('a feed with an unread tx is re-read on the next request', async () => {
  let calls = 0;
  const read = async () => (++calls === 1 ? { txs: [{ hash: 'a', error: 'timeout' }] } : { txs: [{ hash: 'a', events: [] }] });
  const acct = 'retry-' + Math.random() + '.testnet';
  assert.ok((await chronicle(acct, 8, read)).txs[0].error);
  await chronicle(acct, 8, read, Date.now() + 1); // old -> background re-read
  await new Promise(r => setTimeout(r, 10));
  const third = await chronicle(acct, 8, read, Date.now() + 2);
  assert.equal(calls, 2); assert.equal(third.txs[0].error, undefined);
});
