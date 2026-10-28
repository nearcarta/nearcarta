import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fpost, chronicle } from '../../src/shops.js';

const res = (status, body = {}) => ({ ok: status < 300, status, json: async () => body });

test('fpost retries a 429 and returns the answer', async () => {
  const seq = [res(429), res(200, { account_txs: [1] })]; let n = 0;
  assert.deepEqual(await fpost('/account', {}, async () => seq[n++], 1), { account_txs: [1] });
  assert.equal(n, 2);
});

test('fpost: still 429 after retries -> error without status (onError answers 503 + Retry-After)', async () => {
  let n = 0;
  await assert.rejects(fpost('/account', {}, async () => { n++; return res(429); }, 1), e => /http 429/.test(e.message) && e.status === undefined);
  assert.equal(n, 6); // a page feed is high priority: up to 6 tries through the shared cooldown, within its deadline
});

test('fpost: a 4xx other than 429 is not retried', async () => {
  let n = 0;
  await assert.rejects(fpost('/account', {}, async () => { n++; return res(400); }, 1), e => e.status === 502);
  assert.equal(n, 1);
});

test('chronicle: concurrent and repeat calls share one read; a later failure serves the last good feed as stale', async () => {
  let n = 0; const ok = async a => { n++; return { account: a, txs: [n] }; };
  const [x, y] = await Promise.all([chronicle('c1.testnet', 8, ok), chronicle('c1.testnet', 8, ok)]);
  assert.equal(n, 1); assert.deepEqual(x, y);
  assert.deepEqual(await chronicle('c1.testnet', 8, ok), x); assert.equal(n, 1);
  await assert.rejects(chronicle('c2.testnet', 8, async () => { throw new Error('fastnear tx http 429'); }), /429/);
});
