// The Chronicle tray used to read /api/ledger and /api/mainnet on every account load. That fan-out
// is what turned a busy public node into 429s for the room. These tests pin the shared read and the
// route caches so it cannot come back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, deploymentsBody, _resetLastGood } from '../../src/app.js';
import { _resetShared, sharedJson, SHARED_TTL_MS } from '../../../app/src/panels/chronicle-view.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('the same ledger body is fetched once for many account reads', async () => {
  _resetShared();
  let calls = 0;
  const fetchImpl = async () => { calls++; return ok({ rows: [{ tx: 'A' }] }); };
  const first = await sharedJson('https://x/api/ledger', 'ledger', { fetchImpl });
  const second = await sharedJson('https://x/api/ledger', 'ledger', { fetchImpl });
  const third = await sharedJson('https://x/api/ledger', 'ledger', { fetchImpl });
  assert.equal(calls, 1, 'three account loads share one ledger read');
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

test('a burst of account reads shares one in-flight ledger request', async () => {
  _resetShared();
  let calls = 0;
  let release;
  const gate = new Promise(r => { release = r; });
  const fetchImpl = async () => { calls++; await gate; return ok({ rows: [] }); };
  const all = Promise.all(Array.from({ length: 6 }, () => sharedJson('https://x/api/ledger', 'ledger', { fetchImpl })));
  release();
  await all;
  assert.equal(calls, 1, 'six simultaneous readers make one request');
});

test('a shared read is refreshed after its ttl and a failed read is not cached', async () => {
  _resetShared();
  let calls = 0;
  const t0 = 1_000_000;
  const body = async () => { calls++; return ok({ n: calls }); };
  await sharedJson('u', 'ledger', { fetchImpl: body, now: t0 });
  await sharedJson('u', 'ledger', { fetchImpl: body, now: t0 + SHARED_TTL_MS - 1 });
  assert.equal(calls, 1, 'inside the ttl the copy is reused');
  const later = await sharedJson('u', 'ledger', { fetchImpl: body, now: t0 + SHARED_TTL_MS + 1 });
  assert.equal(calls, 2, 'after the ttl it reads again');
  assert.equal(later.n, 2);
  let bad = 0;
  const failing = async () => { bad++; return { ok: false, status: 503, json: async () => ({}) }; };
  assert.equal(await sharedJson('v', 'mainnet', { fetchImpl: failing }), null);
  assert.equal(await sharedJson('v', 'mainnet', { fetchImpl: failing }), null);
  assert.equal(bad, 2, 'a failed read is retried, never cached as an empty answer');
});

test('/api/mainnet and /api/chronicle serve one deployments body, cached in the process', async () => {
  _resetLastGood();
  const a = deploymentsBody();
  const b = deploymentsBody();
  assert.equal(a, b, 'the same object is reused, so the record is not re-read per request');
  const app = makeApp();
  const mainnet = await app.request('/api/mainnet');
  assert.equal(mainnet.status, 200);
  const body = await mainnet.json();
  assert.equal(body.status, 'deployed');
  // The edge cache header lets a judging room behind one host share one copy.
  assert.match(mainnet.headers.get('cache-control') || '', /s-maxage=/);
  const second = await app.request('/api/mainnet');
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), body);
});

test('a load of account reads does not amplify into one ledger call per read', async () => {
  _resetShared();
  _resetLastGood();
  const app = makeApp();
  let ledgerCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/api/ledger')) ledgerCalls++;
    return realFetch(url, init);
  };
  try {
    // 12 account loads is one tray session with Show more on a few accounts.
    for (let i = 0; i < 12; i++) {
      const res = await app.request('/api/mainnet');
      assert.equal(res.status, 200);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(ledgerCalls, 0, 'the route itself never calls its own ledger URL');
});
