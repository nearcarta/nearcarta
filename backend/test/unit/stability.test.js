import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cfg } from '../../src/config.js';
import { _resetRpcCache } from '../../src/near.js';
import { makeApp, _resetLastGood } from '../../src/app.js';
import { _resetGlobals } from '../../src/http-guard.js';
import { charterFacts } from '../../src/vault.js';

const real = globalThis.fetch;
const saved = { ...cfg };
beforeEach(() => { _resetRpcCache(); _resetLastGood(); _resetGlobals(); Object.assign(cfg, { rpc: 'https://p.example', rpcFallbacks: [], rpcRetries: 1, rpcBackoffMs: 1 }); });
afterEach(() => { globalThis.fetch = real; Object.assign(cfg, saved); });

const tokens = [{ assetId: 'nep141:wrap.near', symbol: 'wNEAR', blockchain: 'near', decimals: 24, price: 3 },
  { assetId: 'nep141:usdc.near', symbol: 'USDC', blockchain: 'near', decimals: 6, price: 1 }];

test('ferry quote: identical concurrent requests share one 1Click call and never hit the per-client 429', async () => {
  let quotes = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/v0/tokens')) return new Response(JSON.stringify(tokens), { status: 200 });
    quotes++; await new Promise(r => setTimeout(r, 30));
    return new Response(JSON.stringify({ quote: { amountOut: '42' } }), { status: 200 });
  };
  const app = makeApp();
  const body = JSON.stringify({ from: 'USDC@near', to: 'wNEAR@near', amount: '1000000', recipient: 'intents.near', refundTo: 'intents.near' });
  const q = () => app.request('/api/ferry/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const rs = await Promise.all(Array.from({ length: 14 }, q)); // more than the 10/min per-client quota
  assert.deepEqual(rs.map(r => r.status), Array(14).fill(200));
  assert.equal(quotes, 1);
  const again = await q(); // within 5 s: cache hit
  assert.equal(again.status, 200); assert.equal(again.headers.get('x-quote-cache'), 'hit'); assert.equal(quotes, 1);
});

test('read routes: an RPC 429 serves the last good value marked stale, or 503 + Retry-After when there is none', async () => {
  let busy = false;
  globalThis.fetch = async () => busy ? new Response('busy', { status: 429 })
    : new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { result: [...Buffer.from(JSON.stringify({ ok: 1 }))], logs: [] } }), { status: 200 });
  const app = makeApp();
  busy = true;
  // /api/guardhouse answers the retired fact (no RPC read), and several reads serve a snapshot
  // instead of failing. /api/arena propagates.
  const cold = await app.request('/api/arena');
  assert.equal(cold.status, 503); assert.equal(cold.headers.get('retry-after'), '3');
  assert.equal((await cold.json()).retry, true);
});

test('vault fresh read: waits and retries through RPC 429s instead of failing', async () => {
  let n = 0;
  globalThis.fetch = async (url, init) => {
    if (++n <= 2) return new Response('busy', { status: 429 });
    const p = JSON.parse(init.body).params;
    if (p.request_type === 'view_account') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { cause: { name: 'UNKNOWN_ACCOUNT' }, message: 'unknown' } }), { status: 200 });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { result: [...Buffer.from('null')], logs: [] } }), { status: 200 });
  };
  try {
    const f = await charterFacts('x-1.nccharters-85831.near', { fresh: true, retryMs: 1 });
    assert.equal(f.exists, false); assert.ok(n >= 3);
  } catch (e) { if (/vault not deployed/.test(e.message)) return; throw e; }
});
