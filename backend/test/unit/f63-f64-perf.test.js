// F63/F64 (film 2026-11-12): perf and RPC rate limits. Waits judges felt, and a Guard cancel stuck on
// "waiting for the chain" while the free mainnet RPC answered 429.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rpcClient } from '../../../shared/vault/tx.js';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const ok = (result) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ result }) });
const busy = (ra) => ({ ok: false, status: 429, headers: { get: (k) => (k === 'retry-after' ? ra : null) }, json: async () => ({}) });

test('F64: a URL that answers 429 rests, and the next call starts on another URL', async () => {
  let t = 0; const hits = [];
  const f = async (url) => { hits.push(url); return url === 'a' ? busy('5') : ok({ n: hits.length }); };
  const rpc = rpcClient(['a', 'b'], f, { sleep: async () => {}, now: () => t, cacheMs: 0 });
  await rpc('query', { x: 1 });
  assert.deepEqual(hits, ['a', 'b']);
  hits.length = 0; t += 1000;
  await rpc('query', { x: 2 });
  assert.deepEqual(hits, ['b'], 'a rests for its Retry-After');
  hits.length = 0; t += 10_000;
  await rpc('query', { x: 3 });
  assert.equal(hits[0], 'a', 'after the rest a is tried first again');
});

test('F64: identical reads share one request and are kept briefly; sends are never shared', async () => {
  let t = 0, n = 0;
  const f = async () => { n++; await new Promise((r) => setTimeout(r, 5)); return ok({ n }); };
  const rpc = rpcClient(['a'], f, { now: () => t });
  const [x, y] = await Promise.all([rpc('query', { q: 1 }), rpc('query', { q: 1 })]);
  assert.equal(n, 1); assert.deepEqual(x, y);
  await rpc('query', { q: 1 }); assert.equal(n, 1, 'kept for cacheMs');
  t += 2000; await rpc('query', { q: 1 }); assert.equal(n, 2, 'read again after cacheMs');
  await Promise.all([rpc('send_tx', { s: 1 }), rpc('send_tx', { s: 1 })]); assert.equal(n, 4, 'two sends are two requests');
  await rpc('query', { q: 1 }); assert.equal(n, 5, 'a send forgets kept reads');
  rpc.clear(); await rpc('query', { q: 1 }); assert.equal(n, 6);
});

test('F64: the mainnet client has more than one RPC, and every client read can fall back', () => {
  const net = read('shared/net/net.js');
  const main = net.match(/mainnet: \{[\s\S]*?rpc: \[([^\]]+)\]/)[1].split(',').filter((s) => s.trim());
  assert.ok(main.length >= 3, 'three or more mainnet RPCs');
  assert.match(net, /NEARCARTA_NET = \{[\s\S]*?rpc: cfg\.rpc/);
  assert.match(read('app/design/D8_shops/js/apps.js'), /urls = \[S\.mainnet\.rpc, \.\.\.\(NETCFG\(\)\.rpc \|\| \[\]\)\]/);
  assert.doesNotMatch(read('app/house/play.js'), /const RPC = \(\) =>/);
});

test('F64: a wallet that never answers is reported in words, not an endless "waiting"', () => {
  const a = read('app/design/D8_shops/js/apps.js');
  assert.match(a, /export const SIGN_WAIT_MS = 120_000/);
  assert.match(a, /inTime\(w\.signAndSendTransaction\(/);
  assert.match(a, /did not answer in/);
});

test('F63: guest txs wait EXECUTED_OPTIMISTIC, the crate rides on start, rooms warm all their models', () => {
  assert.match(read('app/src/guest/key.js'), /waitUntil: 'EXECUTED_OPTIMISTIC'/);
  assert.doesNotMatch(read('app/src/guest/key.js'), /waitUntil: 'FINAL'/);
  const g = read('backend/src/guest.js');
  assert.equal((g.match(/waitUntil: 'EXECUTED_OPTIMISTIC'/g) || []).length, 2);
  assert.match(read('app/src/net/chrome.js'), /s\.crate \|\| await welcomeCrate/);
  const core = read('app/design/D8_shops/js/core.js');
  assert.match(core, /export const ROOM_ASSETS/); assert.match(core, /THREE\.Cache\.enabled = true/);
  assert.match(read('app/design/D9_world/js/shops.js'), /C8\.warm\?\.\(id\)/);
  const v = JSON.parse(read('vercel.json'));
  assert.ok(v.headers.some((h) => /glb/.test(h.source) && /max-age=3600/.test(h.headers[0].value)));
  assert.match(read('app/build.mjs'), /minify: true, \/\/ F63/);
});
