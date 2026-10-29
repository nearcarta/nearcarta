import { test } from 'node:test'; import assert from 'node:assert/strict';
import { startKeepWarm } from '../../src/keepwarm.js';
test('keep-warm: off without url, off after end date, off with KEEP_WARM=0', () => {
  assert.equal(startKeepWarm({ env: {} }), null);
  assert.equal(startKeepWarm({ env: { RENDER_EXTERNAL_URL: 'https://x', KEEP_WARM_UNTIL: '2020-01-01' } }), null);
  assert.equal(startKeepWarm({ env: { RENDER_EXTERNAL_URL: 'https://x', KEEP_WARM: '0' } }), null);
});
test('keep-warm: pings /api/health and stops after the end date', async () => {
  let t0 = Date.parse('2026-11-01'); const hits = [];
  const h = startKeepWarm({ env: { RENDER_EXTERNAL_URL: 'https://x/' }, now: () => t0, fetchFn: async u => hits.push(u), every: 5 });
  await new Promise(r => setTimeout(r, 30)); assert.ok(hits.length >= 1); assert.equal(hits[0], 'https://x/api/health');
  t0 = Date.parse('2026-11-26'); await new Promise(r => setTimeout(r, 20)); const n = hits.length;
  await new Promise(r => setTimeout(r, 20)); assert.equal(hits.length, n); clearInterval(h);
});
