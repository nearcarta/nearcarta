import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rpcClient } from '../../../shared/vault/tx.js';
import { ruleChip, DEFAULT_RULES } from '../../../app/design/D8_shops/js/rules-default.js';

const DEP = JSON.parse(readFileSync(new URL('../../../shared/deployments/testnet.json', import.meta.url)));
const ok = (result) => ({ ok: true, status: 200, json: async () => ({ result }) });
const http = (status) => ({ ok: false, status, json: async () => ({}) });
const noSleep = { sleep: async () => {} };

test('testnet.json lists backup RPCs other than the primary', () => {
  assert.ok(DEP.rpc_fallbacks.length >= 2);
  assert.ok(!DEP.rpc_fallbacks.includes(DEP.rpc));
  assert.ok(DEP.rpc_fallbacks.some(u => !/fastnear/.test(u)), 'at least one non-fastnear backup');
});

for (const code of [408, 425, 429, 500, 502, 503, 504]) {
  test(`frontend rpcClient rotates to the backup on ${code}`, async () => {
    const seen = [];
    const f = async (url) => { seen.push(url); return url === 'A' ? http(code) : ok('fine'); };
    assert.equal(await rpcClient(['A', 'B'], f, noSleep)('status', []), 'fine');
    assert.deepEqual(seen, ['A', 'B']);
  });
}

test('frontend rpcClient does not rotate on a 400 (a real answer)', async () => {
  const seen = [];
  const f = async (url) => { seen.push(url); return http(400); };
  await assert.rejects(rpcClient(['A', 'B'], f, noSleep)('status', []), /http 400/);
  assert.deepEqual(seen, ['A']);
});

test('frontend rpcClient rotates on a network error', async () => {
  const f = async (url) => { if (url === 'A') throw new Error('offline'); return ok(7); };
  assert.equal(await rpcClient(['A', 'B'], f, noSleep)('block', {}), 7);
});

test('backend cfg.rpcFallbacks defaults to testnet.json backups', async () => {
  if (process.env.NEAR_RPC_FALLBACKS) return;
  const { cfg } = await import('../../src/config.js');
  assert.deepEqual(cfg.rpcFallbacks, DEP.rpc_fallbacks);
});

test('backend rpc() falls back from a 408 primary', async () => {
  const { cfg } = await import('../../src/config.js');
  const { rpc, _resetRpcCache } = await import('../../src/near.js');
  _resetRpcCache();
  const real = globalThis.fetch; const seen = [];
  const save = { r: cfg.rpcBackoffMs };
  cfg.rpcBackoffMs = 0;
  globalThis.fetch = async (url, o) => { seen.push(url); return url === cfg.rpc ? new Response('', { status: 408 }) : new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: 1 } }), { status: 200 }); };
  try { assert.deepEqual(await rpc('status', []), { ok: 1 }); } finally { globalThis.fetch = real; cfg.rpcBackoffMs = save.r; }
  assert.equal(seen[0], cfg.rpc); assert.notEqual(seen[1], cfg.rpc);
});

test('rules chip: default cap has no hint', () => {
  const r = ruleChip(DEFAULT_RULES.cap);
  assert.equal(r.changed, false); assert.doesNotMatch(r.text, /Town Hall/);
});
test('rules chip: lowered cap says changed in Town Hall', () => {
  const r = ruleChip(0.03);
  assert.equal(r.changed, true); assert.match(r.text, /max 0\.03 NEAR · changed in Town Hall/); assert.match(r.title, /default cap is 0\.05 NEAR/);
});
test('rules chip: no clause', () => {
  assert.deepEqual(ruleChip(null), { text: 'Your rules', changed: false, title: '' });
});
