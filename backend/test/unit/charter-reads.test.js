import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cfg } from '../../src/config.js';
import { _resetRpcCache } from '../../src/near.js';
import { makeApp } from '../../src/app.js';

const real = globalThis.fetch;
const saved = { ...cfg };
const rpcReply = (body) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: body }), { status: 200, headers: { 'content-type': 'application/json' } });
const viewResult = (v) => rpcReply({ result: [...Buffer.from(JSON.stringify(v))], logs: [] });
let asked;
beforeEach(() => { asked = []; _resetRpcCache(); Object.assign(cfg, { rpc: 'https://p.example', rpcFallbacks: [], rpcRetries: 1, rpcBackoffMs: 1 }); });
afterEach(() => { globalThis.fetch = real; Object.assign(cfg, saved); });
const mock = (fn) => { globalThis.fetch = async (url, init) => { const p = JSON.parse(init.body).params; asked.push(p); return fn(p); }; };

test('reputation: R16 charter answers with its on-chain counts', async () => {
  mock(() => viewResult({ score: 20, min_proposals_for_score: 5, counts: { proposals: 5 }, rotating_key: false }));
  const r = await makeApp().request('/api/charter/c1.factory.testnet/reputation');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.supported, true); assert.equal(j.reputation.score, 20);
  assert.equal(asked[0].method_name, 'get_reputation'); assert.equal(asked[0].account_id, 'c1.factory.testnet');
});

test('reputation: an older charter without the method says supported:false', async () => {
  mock(() => rpcReply({ error: 'wasm execution failed with error: MethodResolveError(MethodNotFound)', logs: [] }));
  const j = await (await makeApp().request('/api/charter/old.testnet/reputation')).json();
  assert.equal(j.supported, false);
});

test('rules: passes the clause id, 404 for an unknown clause, 400 for bad input', async () => {
  mock((p) => viewResult(JSON.parse(Buffer.from(p.args_base64, 'base64')).clause_id === 'pay' ? { clause_id: 'pay', expires_at: null } : null));
  const app = makeApp();
  const ok = await app.request('/api/charter/c1.testnet/rules/pay');
  assert.equal(ok.status, 200); assert.equal((await ok.json()).rules.clause_id, 'pay');
  assert.equal((await app.request('/api/charter/c1.testnet/rules/nope')).status, 404);
  assert.equal((await app.request('/api/charter/c1.testnet/rules/' + encodeURIComponent('a b'))).status, 400);
  assert.equal((await app.request('/api/charter/' + encodeURIComponent('Bad..Acct') + '/reputation')).status, 400);
});

test('reputation: RPC overload (429 everywhere) is a 503 with Retry-After, not a 500', async () => {
  mock(() => new Response('slow down', { status: 429 }));
  const r = await makeApp().request('/api/charter/busy.testnet/reputation');
  assert.equal(r.status, 503); assert.equal(r.headers.get('retry-after'), '10');
});

test('health: RPC 429 on status still answers 200 (Render health check must not restart the box)', async () => {
  mock(() => new Response('slow down', { status: 429 }));
  const r = await makeApp().request('/api/health');
  assert.equal(r.status, 200);
  const j = await r.json(); assert.equal(j.ok, true); assert.match(j.near.error, /429/);
});
