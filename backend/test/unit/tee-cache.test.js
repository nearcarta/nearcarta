// The 5-minute TEE attestation cache behind /api/ai/tee and the agent preflight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedProveTee, teeCached, _clearTeeCache } from '../../src/tee.js';

const fake = () => { const f = async o => { f.calls++; return { ok: true, nonce: o.nonce || 'server', models: [] }; }; f.calls = 0; return f; };
const N = n => String(n).repeat(64).slice(0, 64);

test('a repeated nonce or no nonce is served from the cache; a new nonce is a miss', async () => {
  _clearTeeCache(); const run = fake();
  const a = await cachedProveTee({ nonce: N(1) }, { run });
  const b = await cachedProveTee({ nonce: N(1) }, { run });
  assert.equal(a.cache.hit, false); assert.equal(b.cache.hit, true); assert.equal(b.nonce, N(1));
  await cachedProveTee({ nonce: N(2) }, { run });
  for (let i = 0; i < 10; i++) await cachedProveTee({}, { run });
  assert.equal(run.calls, 3);
  assert.equal(teeCached({ nonce: N(1) }), true); assert.equal(teeCached({ nonce: N(3) }), false);
});

test('entries expire after the TTL', async () => {
  _clearTeeCache(); const run = fake(); let t = 0; const now = () => t;
  await cachedProveTee({}, { run, now, ttlMs: 1000 }); t = 999;
  assert.equal((await cachedProveTee({}, { run, now, ttlMs: 1000 })).cache.hit, true); t = 1000;
  assert.equal((await cachedProveTee({}, { run, now, ttlMs: 1000 })).cache.hit, false);
  assert.equal(run.calls, 2);
});

test('a failed or thrown check is not cached', async () => {
  _clearTeeCache(); let n = 0;
  const bad = async () => { n++; return { ok: false }; };
  await cachedProveTee({}, { run: bad }); await cachedProveTee({}, { run: bad });
  assert.equal(n, 2);
  const boom = async () => { n++; throw new Error('upstream 502'); };
  await assert.rejects(cachedProveTee({ nonce: N(4) }, { run: boom }));
  assert.equal(teeCached({ nonce: N(4) }), false);
});

test('concurrent identical calls share one fetch', async () => {
  _clearTeeCache(); const run = fake();
  await Promise.all(Array.from({ length: 5 }, () => cachedProveTee({}, { run })));
  assert.equal(run.calls, 1);
});
