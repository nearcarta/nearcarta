import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../../src/app.js';
import { DEP } from '../../src/config.js';

const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

test('chronicle: tx index still busy and nothing cached -> 200 busy + Retry-After, not 503', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 429 });
  const r = await makeApp().request(`/api/chronicle/${DEP.guardhouse.oath}?limit=13`);
  assert.equal(r.status, 200); assert.equal(r.headers.get('retry-after'), '10');
  const j = await r.json(); assert.equal(j.busy, true); assert.deepEqual(j.txs, []); assert.match(j.source, /busy/);
});
