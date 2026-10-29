import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../../src/app.js';

test('/api/whoami answers with a tag and hop counts, never an address', async () => {
  const was = process.env.RENDER; process.env.RENDER = 'true'; // key on the connecting address, as on Render
  const app = makeApp();
  const ask = ip => app.request('/api/whoami', { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1`, 'x-real-ip': ip, 'cf-connecting-ip': ip, 'true-client-ip': ip } });
  const a = await (await ask('203.0.113.7')).text(), a2 = await (await ask('203.0.113.7')).text(), b = await (await ask('198.51.100.9')).text();
  for (const t of [a, b]) {
    assert.doesNotMatch(t, /\b\d{1,3}(\.\d{1,3}){3}\b/);
    assert.doesNotMatch(t, /203\.0\.113|198\.51\.100|10\.0\.0\.1/);
  }
  const ja = JSON.parse(a), jb = JSON.parse(b);
  assert.equal(ja.ip_headers['x-forwarded-for'], '2 hop(s)');
  assert.ok(!('client_ip' in ja));
  if (was === undefined) delete process.env.RENDER; else process.env.RENDER = was;
  assert.match(ja.client_tag, /^[0-9a-f]{12}$/);
  assert.equal(JSON.parse(a2).client_tag, ja.client_tag); // same client, same bucket tag
  assert.notEqual(jb.client_tag, ja.client_tag);         // another client, another tag
});
