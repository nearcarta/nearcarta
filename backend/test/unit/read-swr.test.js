import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swr, READ_TTL_MS, READ_STALE_MS, _resetLastGood } from '../../src/app.js';

const clock = () => { let t = 1_000_000; const now = () => t; now.add = ms => { t += ms; }; return now; };
const tick = () => new Promise(r => setImmediate(r));

test('swr: first read waits, then serves from cache inside the TTL', async () => {
  _resetLastGood(); const now = clock(); let calls = 0;
  const r = swr('t1', async () => ({ n: ++calls }), { now });
  assert.deepEqual(await r(), { n: 1 });
  now.add(READ_TTL_MS - 1);
  assert.deepEqual(await r(), { n: 1 }); assert.equal(calls, 1);
});

test('swr: stale value returned at once, one shared background refresh', async () => {
  _resetLastGood(); const now = clock(); let calls = 0, release;
  const r = swr('t2', () => (++calls === 1 ? Promise.resolve({ n: 1 }) : new Promise(res => { release = () => res({ n: calls }); })), { now });
  await r(); now.add(READ_TTL_MS + 1);
  const [a, b] = await Promise.all([r(), r()]);
  assert.deepEqual(a, { n: 1 }); assert.deepEqual(b, { n: 1 }); assert.equal(calls, 2);
  release(); await tick(); await tick();
  assert.deepEqual(await r(), { n: 2 });
});

test('swr: past the stale window the caller waits for a fresh read', async () => {
  _resetLastGood(); const now = clock(); let calls = 0;
  const r = swr('t3', async () => ({ n: ++calls }), { now });
  await r(); now.add(READ_STALE_MS + 1);
  assert.deepEqual(await r(), { n: 2 });
});

test('swr: a failed background refresh keeps the cached value; cold failure throws', async () => {
  _resetLastGood(); const now = clock(); let fail = false;
  const r = swr('t4', async () => { if (fail) throw new Error('rpc down'); return { ok: 1 }; }, { now });
  await r(); fail = true; now.add(READ_TTL_MS + 1);
  assert.deepEqual(await r(), { ok: 1 }); await tick(); await tick();
  assert.deepEqual(await r(), { ok: 1 });
  const cold = swr('t5', async () => { throw new Error('rpc down'); }, { now });
  await assert.rejects(cold(), /rpc down/);
});
