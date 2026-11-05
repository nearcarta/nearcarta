import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../../src/app.js';
import { MAINNET_DEP } from '../../src/config.js';
import { _setSnapshots } from '../../src/shops.js';
_setSnapshots(null); // these tests cover the no-snapshot path

const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

test('chronicle: tx index still busy and nothing cached -> 200 busy + Retry-After, not 503', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 429 });
  const a = MAINNET_DEP.charter.contract;
  const r = await makeApp().request(`/api/chronicle/${a}?limit=13`);
  assert.equal(r.status, 200); assert.equal(r.headers.get('retry-after'), '10');
  const j = await r.json(); assert.equal(j.busy, true); assert.deepEqual(j.txs, []); assert.match(j.source, /busy/);
});
