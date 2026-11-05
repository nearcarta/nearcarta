import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cfg } from '../../src/config.js';
import { rpc, rpcStats, _resetRpcCache } from '../../src/near.js';

const real = globalThis.fetch;
const saved = { ...cfg };
let calls;
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (result) => reply(200, { jsonrpc: '2.0', id: 1, result });
const params = (n) => ({ request_type: 'view_account', finality: 'final', account_id: `a${n}.near` });

beforeEach(() => {
  calls = []; _resetRpcCache();
  Object.assign(cfg, { rpc: 'https://p.example', rpcFallbacks: ['https://f1.example'], rpcRetries: 2, rpcBackoffMs: 1, rpcCacheMs: 5000, rpcStaleMs: 60000 });
});
afterEach(() => { globalThis.fetch = real; Object.assign(cfg, saved); });

test('429 is retried, then answered', async () => {
  let n = 0;
  cfg.rpcFallbacks = [];
  globalThis.fetch = async (url) => { calls.push(url); return ++n === 1 ? reply(429, {}) : ok({ amount: '1' }); };
  assert.deepEqual(await rpc('query', params(1)), { amount: '1' });
  assert.deepEqual(calls, ['https://p.example', 'https://p.example'], 'after a backoff the primary is asked again');
});

test('primary keeps failing: falls back to the next URL', async () => {
  globalThis.fetch = async (url) => { calls.push(url); return url.startsWith('https://p') ? reply(503, {}) : ok({ amount: '2' }); };
  assert.deepEqual(await rpc('query', params(2)), { amount: '2' });
  assert.deepEqual(calls, ['https://p.example', 'https://f1.example']);
});

test('a real RPC error (unknown account) is not retried', async () => {
  globalThis.fetch = async (url) => { calls.push(url); return reply(200, { jsonrpc: '2.0', id: 1, error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT' } } }); };
  await assert.rejects(rpc('query', params(3)), /UNKNOWN_ACCOUNT/);
  assert.equal(calls.length, 1);
});

test('views are cached; when every URL fails a recent answer is served stale', async () => {
  globalThis.fetch = async (url) => { calls.push(url); return ok({ amount: '4' }); };
  await rpc('query', params(4));
  await rpc('query', params(4));
  assert.equal(calls.length, 1, 'second call is a cache hit');
  cfg.rpcCacheMs = 0; // force a refetch
  globalThis.fetch = async (url) => { calls.push(url); return reply(429, {}); };
  const before = rpcStats.staleServed;
  assert.deepEqual(await rpc('query', params(4)), { amount: '4' });
  assert.equal(rpcStats.staleServed, before + 1);
});

test('nothing cached and every URL down: the error is thrown', async () => {
  globalThis.fetch = async () => reply(502, {});
  await assert.rejects(rpc('query', params(5)), /http 502/);
});

test('status is never cached', async () => {
  globalThis.fetch = async (url) => { calls.push(url); return ok({ chain_id: 'mainnet' }); };
  await rpc('status', []); await rpc('status', []);
  assert.equal(calls.length, 2);
});
