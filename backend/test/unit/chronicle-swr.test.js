import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chronicle, chronicleOnce, _resetFeeds, FEED_MAX, FEED_TTL_MS, FEED_STALE_MS } from '../../src/shops.js';
import { makeApp, warm } from '../../src/app.js';
import { DEP } from '../../src/config.js';
import { _setSnapshots } from '../../src/shops.js';
_setSnapshots(null); // these tests cover the no-snapshot path

const rows = n => Array.from({ length: n }, (_, i) => ({ hash: 'h' + i }));
const reader = () => { const r = async (a, limit) => { r.n++; r.limits.push(limit); return { account: a, count: limit, source: 'test', txs: rows(limit) }; }; r.n = 0; r.limits = []; return r; };
const tick = () => new Promise(r => setImmediate(r));
beforeEach(() => _resetFeeds());

test('one read at FEED_MAX serves every limit as a slice', async () => {
  const r = reader(), t = 1e6;
  const a = await chronicle('a.testnet', 3, r, t), b = await chronicle('a.testnet', 12, r, t + 10), c = await chronicle('a.testnet', 99, r, t + 20);
  assert.equal(r.n, 1); assert.deepEqual(r.limits, [FEED_MAX]);
  assert.equal(a.txs.length, 3); assert.equal(a.count, 3); assert.equal(b.txs.length, 12); assert.equal(c.txs.length, FEED_MAX);
  assert.equal(a.stale, undefined);
});

test('fresh within the TTL: no new read', async () => {
  const r = reader(); const t = Date.now();
  await chronicle('b.testnet', 8, r, t); await chronicle('b.testnet', 8, r, t + FEED_TTL_MS - 1);
  assert.equal(r.n, 1);
});

test('past the TTL: answers the cached feed at once (stale) and refreshes once in the background', async () => {
  const r = reader(); await chronicle('c.testnet', 8, r);
  let release; const slow = async (a, l) => { slow.n = (slow.n || 0) + 1; await new Promise(res => { release = res; }); return { account: a, txs: rows(l).map(x => ({ hash: 'new' + x.hash })) }; };
  const later = Date.now() + FEED_TTL_MS + 5;
  const [x, y] = await Promise.all([chronicle('c.testnet', 8, slow, later), chronicle('c.testnet', 8, slow, later)]);
  assert.equal(x.stale, true); assert.equal(x.txs[0].hash, 'h0'); assert.equal(y.stale, true);
  assert.equal(slow.n, 1); // the two callers share one background read
  release(); await tick(); await tick();
  const z = await chronicle('c.testnet', 8, r);
  assert.equal(z.txs[0].hash, 'newh0'); assert.equal(z.stale, undefined); assert.equal(r.n, 1);
});

test('past the stale window: the caller waits for a fresh read', async () => {
  const r = reader(); await chronicle('d.testnet', 8, r);
  const z = await chronicle('d.testnet', 8, r, Date.now() + FEED_STALE_MS + 1);
  assert.equal(r.n, 2); assert.equal(z.stale, undefined);
});

test('a failed background refresh keeps the last good feed; nothing cached + failure -> error', async () => {
  const r = reader(); await chronicle('e.testnet', 8, r);
  const bad = async () => { throw new Error('fastnear tx http 429'); };
  const s = await chronicle('e.testnet', 8, bad, Date.now() + FEED_TTL_MS + 5); assert.equal(s.stale, true); await tick(); await tick();
  const again = await chronicle('e.testnet', 8, bad, Date.now() + FEED_STALE_MS + 1); assert.equal(again.stale, true); assert.equal(again.txs.length, 8);
  await assert.rejects(chronicle('f.testnet', 8, bad), /429/);
});

test('chronicleOnce re-reads the txs in parallel and keeps the index order', async () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ transaction_hash: 'T' + i, tx_block_timestamp: String(1_700_000_000_000_000_000 + i) }));
  const post = async path => path === '/account' ? { account_txs: list } : { transactions: [] };
  let live = 0, peak = 0;
  const status = async h => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 20)); live--;
    if (h === 'T3') throw new Error('rpc down');
    return { transaction: { hash: h, signer_id: 's.testnet', receiver_id: 'a.testnet', actions: [{ FunctionCall: { method_name: 'propose' } }] }, status: { SuccessValue: '' }, receipts_outcome: [], transaction_outcome: { outcome: { logs: [] } } }; };
  const j = await chronicleOnce('a.testnet', 10, { post, status });
  assert.deepEqual(j.txs.map(t => t.hash), list.map(t => t.transaction_hash));
  assert.match(j.txs[3].error, /rpc down/);
  assert.ok(peak > 1 && peak <= 6, 'bounded parallel reads, peak ' + peak);
});

test('GET /api/chronicle is the guardhouse oath feed (no deployments read needed); busy with nothing cached -> 200 busy', async () => {
  const real = globalThis.fetch; globalThis.fetch = async () => new Response('{}', { status: 429 });
  try {
    const r = await makeApp().request('/api/chronicle?limit=3');
    assert.equal(r.status, 200); assert.equal(r.headers.get('retry-after'), '10');
    const j = await r.json(); assert.equal(j.account, DEP.guardhouse.oath); assert.equal(j.busy, true);
  } finally { globalThis.fetch = real; }
});

test('warm() pre-reads the town feed at FEED_MAX, so the first request is served from the cache', async () => {
  const r = reader(); const w = warm({ every: 0, read: r }); await w.first; w.stop();
  assert.equal(r.n, 1);
  const res = await makeApp().request('/api/chronicle?limit=3'); const j = await res.json();
  assert.equal(res.status, 200); assert.equal(j.account, DEP.guardhouse.oath); assert.equal(j.txs.length, 3); assert.equal(r.n, 1);
  const res2 = await makeApp().request(`/api/chronicle/${DEP.guardhouse.oath}?limit=12`); const j2 = await res2.json();
  assert.equal(j2.txs.length, 12); assert.equal(r.n, 1);
});

test('a cold read slower than the cold wait answers timeout at once; the read keeps going and serves the next call', async () => {
  let finished = false;
  const slow = async (a, l) => { await new Promise(res => setTimeout(res, 80)); finished = true; return { account: a, txs: rows(l) }; };
  await assert.rejects(chronicle('cold.testnet', 8, slow, Date.now(), 15), /timeout/);
  assert.equal(finished, false);
  for (let i = 0; i < 20 && !finished; i++) await new Promise(res => setTimeout(res, 20));
  assert.equal(finished, true);
  const z = await chronicle('cold.testnet', 8, async () => { throw new Error('should be cached'); });
  assert.equal(z.txs.length, 8); assert.equal(z.stale, undefined);
});
