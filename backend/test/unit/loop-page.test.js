import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../../app/src/loop.html', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'));
test('loop page: timer, the two real calls, a plain plan, routes', () => {
  for (const s of ['data-testid="loop-clock"', "/api/vault/ask", "/api/vault/attack", "/api/ledger", 'does not spend your NEAR', 'Run the check', 'under 2 min']) assert.ok(html.includes(s), s);
  const src = vercel.rewrites.map(r => r.source);
  assert.ok(src.includes('/loop') && src.includes('/ledger'));
});
