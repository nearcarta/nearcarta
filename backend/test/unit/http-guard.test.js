import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { clientIp, limiter, globalCap, leakGuard, onError, allowedOrigins } from '../../src/http-guard.js';
import { makeApp } from '../../src/app.js';

const fake = (h, env) => clientIp({ req: { header: n => h[n] }, env: {} }, env);
const body = JSON.stringify({ amount: '1', salt: '0'.repeat(32) });
const post = (app, headers) => app.request('/api/mistbank/verify', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

test('client IP comes from the edge header, never from a client-typed X-Forwarded-For', () => {
  assert.equal(fake({ 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '9.9.9.9' }, { RENDER: 'true' }), '9.9.9.9');
  assert.equal(fake({ 'x-forwarded-for': '1.2.3.4' }, { RENDER: 'true' }), 'render:unknown');
  assert.equal(fake({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '8.8.8.8' }, { VERCEL: '1' }), '8.8.8.8');
  assert.equal(fake({ 'x-forwarded-for': '1.2.3.4' }, {}), 'local');
});

test('25 parallel requests with 25 spoofed X-Forwarded-For values share one quota', async () => {
  process.env.RENDER = 'true';
  try {
    const app = makeApp();
    const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => post(app, { 'x-forwarded-for': `10.0.0.${i}`, 'cf-connecting-ip': '203.0.113.7' })));
    const codes = rs.map(r => r.status);
    assert.equal(codes.filter(s => s === 200).length, 10); // limiter(10) on this route
    assert.equal(codes.filter(s => s === 429).length, 15);
    assert.ok(rs.find(r => r.status === 429).headers.get('retry-after'));
    // a different real client is unaffected
    assert.equal((await post(app, { 'cf-connecting-ip': '203.0.113.8' })).status, 200);
  } finally { delete process.env.RENDER; }
});

test('a global cap holds across 25 different clients', async () => {
  const app = new Hono();
  app.get('/x', limiter(100, 60e3, { ip: c => c.req.header('cf-connecting-ip') }), globalCap('test-cap', 5), c => c.json({ ok: true }));
  const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => app.request('/x', { headers: { 'cf-connecting-ip': `198.51.100.${i}` } })));
  assert.equal(rs.filter(r => r.status === 200).length, 5);
  assert.equal(rs.filter(r => r.status === 503).length, 20);
});

test('the leak guard blocks a response carrying a viewing key, a salt or an amount', async () => {
  const app = new Hono(); app.use('*', leakGuard);
  app.get('/k', c => c.json({ k: 'uviewtest1' + 'q'.repeat(40) }));
  app.get('/s', c => c.json({ memo: 'x salt=' + 'a'.repeat(32) }));
  app.get('/z', c => c.json({ zats: 5 }));
  app.get('/ok', c => c.json({ commitment: 'ab'.repeat(32) }));
  for (const p of ['/k', '/s', '/z']) { const r = await app.request(p); assert.equal(r.status, 500); assert.deepEqual(await r.json(), { error: 'internal' }); }
  assert.equal((await app.request('/ok')).status, 200);
});

test('errors: validation keeps its message, anything else is generic', async () => {
  const app = new Hono(); app.onError(onError);
  app.get('/boom', () => { throw new Error('secret internals at /srv/x'); });
  app.get('/up', () => { throw Object.assign(new Error('fastnear tx http 500 body…'), { status: 502 }); });
  app.get('/v', () => { throw Object.assign(new Error('bad txid'), { status: 400 }); });
  assert.deepEqual(await (await app.request('/boom')).json(), { error: 'internal' });
  assert.deepEqual(await (await app.request('/up')).json(), { error: 'upstream error' });
  assert.deepEqual(await (await app.request('/v')).json(), { error: 'bad txid' });
});

test('CORS allows only our origins; security headers are set; the opening is POST-only', async () => {
  assert.deepEqual(allowedOrigins('*'), allowedOrigins(undefined));
  const app = makeApp();
  const good = await post(app, { origin: 'https://nearcarta.vercel.app', 'cf-connecting-ip': '192.0.2.1' });
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://nearcarta.vercel.app');
  const evil = await post(app, { origin: 'https://evil.example', 'cf-connecting-ip': '192.0.2.2' });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.equal(good.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(good.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(good.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal((await app.request('/api/mistbank/verify?amount=1&salt=00')).status, 405);
  const bad = await app.request('/api/ferry/quote', { method: 'POST', body: '{not json', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
});
