// Client identity behind the Vercel rewrite (measured live 2026-10-28: through Vercel, CF-Connecting-IP is a
// Vercel egress address and X-Vercel-Forwarded-For carries the visitor, overwritten by Vercel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { limiter, clientIdentity, EGRESS_MULT } from '../../src/http-guard.js';

const RENDER = { RENDER: 'true' };
const SECRET = 'a'.repeat(40);
const ctx = (h, env = RENDER) => clientIdentity({ req: { header: n => h[n] }, env: {} }, env);

test('direct call: CF-Connecting-IP is the key, no egress bucket', () => {
  assert.deepEqual(ctx({ 'cf-connecting-ip': '1.1.1.1' }), ['cf-connecting-ip', '1.1.1.1', null]);
});
test('through Vercel: visitor IP is the key, the Vercel egress gets a capped bucket', () => {
  assert.deepEqual(ctx({ 'cf-connecting-ip': '54.70.0.1', 'x-vercel-forwarded-for': '2.2.2.2' }),
    ['x-vercel-forwarded-for (capped per connecting ip)', '2.2.2.2', 'egress:54.70.0.1']);
});
test('verified proxy secret: visitor IP, no egress bucket; a wrong or short secret is not verified', () => {
  const h = { 'cf-connecting-ip': '54.70.0.1', 'x-vercel-forwarded-for': '2.2.2.2', 'x-nearcarta-proxy': SECRET };
  assert.equal(ctx(h, { ...RENDER, PROXY_SECRET: SECRET })[2], null);
  assert.equal(ctx({ ...h, 'x-nearcarta-proxy': 'b'.repeat(40) }, { ...RENDER, PROXY_SECRET: SECRET })[2], 'egress:54.70.0.1');
  assert.equal(ctx(h, { ...RENDER, PROXY_SECRET: 'short' })[2], 'egress:54.70.0.1');
});
test('a non-IP X-Vercel-Forwarded-For is ignored', () => {
  assert.equal(ctx({ 'cf-connecting-ip': '1.1.1.1', 'x-vercel-forwarded-for': 'x, 6.6.6.6' })[1], '1.1.1.1');
});

const app = () => { const a = new Hono(); a.get('/x', limiter(3, 60e3, { identity: c => clientIdentity(c, RENDER) }), c => c.json({ ok: 1 })); return a; };
const hit = (a, h) => a.request('/x', { headers: h }).then(r => r.status);

test('two visitors behind ONE Vercel egress get separate quotas', async () => {
  const a = app(), eg = { 'cf-connecting-ip': '54.70.0.1' };
  const A = [], B = [];
  for (let i = 0; i < 4; i++) A.push(await hit(a, { ...eg, 'x-vercel-forwarded-for': '2.2.2.2' }));
  for (let i = 0; i < 3; i++) B.push(await hit(a, { ...eg, 'x-vercel-forwarded-for': '3.3.3.3' }));
  assert.deepEqual(A, [200, 200, 200, 429]);
  assert.deepEqual(B, [200, 200, 200]);
});
test('a direct caller faking X-Vercel-Forwarded-For gets at most EGRESS_MULT x one quota', async () => {
  const a = app(); let ok = 0;
  for (let i = 0; i < 3 * EGRESS_MULT + 20; i++) if (await hit(a, { 'cf-connecting-ip': '9.9.9.9', 'x-vercel-forwarded-for': `10.0.${i >> 8}.${i & 255}` }) === 200) ok++;
  assert.equal(ok, 3 * EGRESS_MULT);
});
