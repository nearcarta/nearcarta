import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const html = readFileSync(new URL('../../../app/src/ferry-widget.html', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'));

test('the ferry widget asks for a dry quote and says nothing is spent', () => {
  assert.match(html, /\/api\/ferry\/quote/);
  assert.match(html, /nothing is sent and nothing is spent/);
  assert.ok(vercel.rewrites.some(r => r.source === '/ferry-widget'));
});

test('the live swap script refuses to create a deposit', () => {
  const r = spawnSync(process.execPath, ['backend/scripts/ferry-live-swap.js', '--live'], { cwd: new URL('../../..', import.meta.url), encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /dry:true/);
});
