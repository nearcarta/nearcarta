import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the tx index defaults to the mainnet FastNEAR index, never testnet', async () => {
  const saved = process.env.FASTNEAR_TX_API;
  delete process.env.FASTNEAR_TX_API;
  try {
    const { INDEX_URL } = await import('../../src/txindex.js?fresh=' + Date.now());
    assert.equal(INDEX_URL, 'https://tx.main.fastnear.com');
    assert.doesNotMatch(INDEX_URL, /test/);
  } finally {
    if (saved !== undefined) process.env.FASTNEAR_TX_API = saved;
  }
});
