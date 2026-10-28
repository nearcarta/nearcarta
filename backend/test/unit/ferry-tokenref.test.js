import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenRef, findToken } from '../../src/ferry.js';
import { makeApp } from '../../src/app.js';

const list = [
  { assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', symbol: 'USDC', blockchain: 'base', decimals: 6, price: 1 },
  { assetId: 'nep141:zec.omft.near', symbol: 'ZEC', blockchain: 'zec', decimals: 8, price: 40 },
];

test('token refs: objects and strings normalize to the same token', () => {
  assert.deepEqual(tokenRef({ symbol: 'USDC', chain: 'base' }), { symbol: 'USDC', chain: 'base' });
  assert.deepEqual(tokenRef('USDC@base'), { symbol: 'USDC', chain: 'base' });
  assert.deepEqual(tokenRef('usdc:BASE'), { symbol: 'usdc', chain: 'base' });
  assert.deepEqual(tokenRef('nep141:zec.omft.near'), { assetId: 'nep141:zec.omft.near' });
  assert.deepEqual(tokenRef({ assetId: 'nep141:zec.omft.near' }), { assetId: 'nep141:zec.omft.near' });
  for (const v of ['USDC', '', 'a@b@c', null, 5, [], {}, { symbol: 'USDC' }, { symbol: 1, chain: 'base' }, { assetId: 'x' }, '<script>@base'])
    assert.equal(tokenRef(v), null, JSON.stringify(v));
  assert.equal(findToken(list, { symbol: 'USDC', chain: 'base' }).symbol, 'USDC');
  assert.equal(findToken(list, 'USDC@base').symbol, 'USDC');
  assert.equal(findToken(list, 'ZEC@zec').blockchain, 'zec');
  assert.equal(findToken(list, 'USDC'), undefined); // never throws (the old code crashed with a 500)
});

test('POST /api/ferry/quote accepts both shapes and refuses malformed ones with 400', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).endsWith('/v0/tokens')
    ? new Response(JSON.stringify(list), { status: 200 })
    : new Response(JSON.stringify({ message: 'mock refuses' }), { status: 400 });
  try {
    const app = makeApp();
    const q = (from, to) => app.request('/api/ferry/quote', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, amount: '1', recipient: '0x552ad18e18a49ddad1e7d96b7ddf813b04a9cfb5', refundTo: '0x552ad18e18a49ddad1e7d96b7ddf813b04a9cfb5' }) });
    for (const [from, to] of [[{ symbol: 'USDC', chain: 'base' }, { symbol: 'USDC', chain: 'base' }], ['USDC@base', 'USDC@base']]) {
      const r = await q(from, to); const j = await r.json();
      assert.equal(r.status, 200, JSON.stringify(j));
      assert.equal(j.ok, false); assert.equal(j.http, 400); // reached 1Click (mocked): the shape was accepted
    }
    const b1 = await q('USDC', 'USDC@base'); assert.equal(b1.status, 400); assert.match((await b1.json()).error, /bad from/);
    const b2 = await q({ symbol: 'USDC', chain: 'base' }, 7); assert.equal(b2.status, 400); assert.match((await b2.json()).error, /bad to/);
    const b3 = await q('NOPE@base', 'USDC@base'); assert.equal(b3.status, 400);
    const b4 = await q('USDC@base', 'ZEC@zec'); assert.equal(b4.status, 400); // an EVM address is not a Zcash recipient: 400, not 500
    assert.match((await b4.json()).error, /Zcash/);
  } finally { globalThis.fetch = realFetch; }
});
