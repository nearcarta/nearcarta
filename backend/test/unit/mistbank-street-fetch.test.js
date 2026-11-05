import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchStreet, ZEC_API } from '../../src/mistbank.js';

const TX = 'a'.repeat(64);
async function withFetch(status, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(status === 200 ? '{}' : 'x', { status });
  try { await fn(); } finally { globalThis.fetch = real; }
}

test('street check: an unmined or unknown Zcash tx is a 404, not an internal error', async () => {
  await withFetch(404, () => assert.rejects(fetchStreet(TX), e => e.status === 404 && /not mined yet/.test(e.message)));
});

test('street check: an explorer outage is a 502', async () => {
  await withFetch(429, () => assert.rejects(fetchStreet(TX), e => e.status === 502));
});

test('street check: a bad txid is a 400 before any fetch', async () => {
  await assert.rejects(fetchStreet('nope'), e => e.status === 400);
});

test('ZEC explorer defaults to mainnet cipherscan', () => {
  assert.match(ZEC_API, /mainnet\.cipherscan\.app/);
  assert.equal(/testnet/i.test(ZEC_API), false);
});
