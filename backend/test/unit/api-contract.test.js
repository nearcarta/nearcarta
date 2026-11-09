// Offline API contract: every route that takes user input refuses bad input before any RPC or paid call,
// security headers are set, unknown routes 404 as JSON, and the deployments route serves shared/deployments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeApp } from '../../src/app.js';
import { otherNet, otherEvm, retiredNet } from '../../../shared/net/word-scan.js';

const app = makeApp();
const get = (p, h = {}) => app.request(p, { headers: { 'cf-connecting-ip': '192.0.2.' + Math.floor(Math.random() * 250), ...h } });
const post = (p, body, h = {}) => app.request(p, { method: 'POST', body, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.' + Math.floor(Math.random() * 250), ...h } });

const badGets = [
  ['/api/guardhouse/check/NOT..AN..ACCOUNT', 'bad account id'],
  ['/api/guardhouse/check/' + 'a'.repeat(65), 'account id over 64 chars'],
  ['/api/guardhouse/action/abc', 'non-numeric action id'],
  ['/api/guardhouse/action/1234567890', 'action id over 9 digits'],
  ['/api/charter/x.near/rules/BAD%20CLAUSE', 'clause id with a space'],
  ['/api/tx/nothash?sender=a.near', 'malformed tx hash'],
  ['/api/tx/11111111111111111111111111111111', 'tx hash without sender'],
  ['/api/ai/tee?nonce=xyz', 'nonce not 64 hex'],
];
for (const [path, why] of badGets) {
  test(`GET ${path.slice(0, 60)} is refused with 4xx (${why})`, async () => {
    const r = await get(path);
    assert.ok(r.status >= 400 && r.status < 500, `${path} -> ${r.status}`);
    assert.ok((await r.json()).error);
  });
}

for (const path of ['/api/mistbank/verify', '/api/mistbank/send/prepare', '/api/mistbank/send', '/api/ferry/quote']) {
  test(`POST ${path} with a non-object body is refused`, async () => {
    for (const body of ['[]', '"x"', 'not json']) {
      const r = await post(path, body);
      assert.ok(r.status >= 400 && r.status < 500, `${path} ${body} -> ${r.status}`);
    }
  });
}

test('an oversized JSON body is refused before it is read', async () => {
  const r = await post('/api/vault/ask', JSON.stringify({ text: 'pay the cafe 0.01 NEAR', pad: 'x'.repeat(20_000) }));
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /too large/);
});

test('the auditor opening is never accepted in a URL', async () => {
  const r = await get('/api/mistbank/verify?amount=1&salt=' + '0'.repeat(32));
  assert.equal(r.status, 405);
});

test('a body over 16 KiB is refused with 413', async () => {
  const r = await post('/api/mistbank/verify', JSON.stringify({ amount: '1', salt: 'a'.repeat(20_000) }));
  assert.equal(r.status, 413);
});

test('unknown API routes return JSON 404', async () => {
  const r = await get('/api/does-not-exist');
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'not found' });
});

test('API responses carry strict security headers', async () => {
  const r = await get('/api/deployments');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'none'/);
  assert.match(r.headers.get('strict-transport-security') || '', /max-age=31536000/);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('/api/deployments serves the committed mainnet deployment file', async () => {
  const dep = await (await get('/api/deployments')).json();
  const file = JSON.parse(readFileSync(new URL('../../../shared/deployments/mainnet.json', import.meta.url)));
  assert.equal(dep.network, 'mainnet');
  assert.equal(dep.board.contract, file.board.contract);
  assert.equal(otherNet.test(JSON.stringify(dep)), false);
});

test('/api/mainnet answers with the mainnet file or not_deployed, never an error', async () => {
  const r = await get('/api/mainnet');
  assert.equal(r.status, 200);
  assert.equal(typeof await r.json(), 'object');
});
test('a guest guard check defaults to the live board, never a retired charter', () => {
  // The guest CTA calls /api/guardhouse/check/:account with no ?charter=. The default must
  // be the live board; it used to be charter.nearcarta.near, which is retired, and the
  // check threw, so every guest check was a 500.
  const file = JSON.parse(readFileSync(new URL('../../../shared/deployments/mainnet.json', import.meta.url)));
  const retired = new Set(Object.keys(file.retired || {}));
  assert.ok(retired.size > 0, 'the record should name the retired charter');
  const src = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("'/api/guardhouse/check/:account'"), src.indexOf("'/api/guardhouse/attested'"));
  assert.ok(route, 'the check route should exist');
  assert.match(route, /c\.req\.query\('charter'\) \|\| BOARD_ID/, 'a guest check defaults to the live board');
  assert.match(src, /const BOARD_ID = MAINNET_DEP\?\.board\?\.contract/, 'the board comes from the deployment record');
  // Code only: strip comments so a note about the retired account does not trip this.
  const code = route.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const dead of retired) assert.doesNotMatch(code, new RegExp(dead.replace(/\./g, '\\.')), `the route code must not name retired ${dead}`);
});

test('/api/guardhouse answers the live board, not the retired oath 404', () => {
  const src = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("app.get('/api/guardhouse',"), src.indexOf("app.get('/api/guardhouse/check"));
  assert.match(route, /guard\.snapshot\(\)/, 'the route reads the live charter (the board)');
  assert.match(route, /guard\.boardSnapshot\(guard\.boardId, \{ owner \}\)/, '?owner= adds that visitor row');
  const gh = readFileSync(new URL('../../src/guardhouse.js', import.meta.url), 'utf8');
  assert.match(gh, /source: 'board'/, 'the payload says it is the board');
  // The retired oath must not be the default charter any more.
  assert.match(gh, /oathId = .*boardId/, 'oathId falls back to the board, never the retired charter');
});

test('/api/whoami never echoes a client IP', async () => {
  const r = await get('/api/whoami', { 'x-forwarded-for': '198.51.100.77', 'x-real-ip': '198.51.100.78' });
  const s = await r.text();
  assert.ok(!s.includes('198.51.100.77') && !s.includes('198.51.100.78'), s);
});

test('the billable completion route is off unless explicitly enabled', async () => {
  const prev = process.env.AI_PROVE_ENABLED; delete process.env.AI_PROVE_ENABLED;
  try {
    const r = await post('/api/ai/prove', '{}');
    assert.ok([403, 503].includes(r.status), String(r.status));
  } finally { if (prev !== undefined) process.env.AI_PROVE_ENABLED = prev; }
});

test('CORS refuses an unknown origin', async () => {
  const r = await app.request('/api/deployments', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  assert.notEqual(r.headers.get('access-control-allow-origin'), 'https://evil.example');
});

test('/api/vault/config returns tasks and attacks arrays the House page maps over', async () => {
  const r = await get('/api/vault/config');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.tasks) && j.tasks.length > 0, 'tasks missing');
  assert.ok(Array.isArray(j.attacks) && j.attacks.length > 0, 'attacks missing');
  assert.ok(j.tasks.every(t => t.id && t.name), 'task shape');
  assert.ok(j.attacks.every(a => a.id && a.name), 'attack shape');
});

test('a guest check against the board does not read get_clauses on the board', () => {
  const src = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("'/api/guardhouse/check/:account'"), src.indexOf("'/api/guardhouse/attested'"));
  assert.match(route, /const boardOnly = charter === BOARD_ID && !found\?\.row;/);
  assert.match(route, /cp\.check\(a, \{ charter: boardOnly \? null : charter, row: found\?\.row \|\| null \}\)/);
});
