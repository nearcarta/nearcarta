import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const html = readFileSync(new URL('../../../app/src/ferry-widget.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../../../app/src/ferry-pay.js', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'));

test('the pay widget quotes a checkout and shows an embed snippet', () => {
  assert.match(html, /id="nearcarta-pay"/);
  assert.match(html, /ferry-pay\.js/);
  assert.match(html, /data-testid="widget-embed"/);
  assert.match(html, /0\.20 USD/);
  assert.match(js, /\/api\/ferry\/checkout/);
  assert.match(js, /\/api\/ferry\/rules/);
  assert.match(js, /\/api\/ferry\/status/);
  assert.match(js, /data-testid="widget-pay"/);
  assert.match(js, /You send the tokens yourself/);
  assert.ok(vercel.rewrites.some(r => r.source === '/ferry-widget'));
});

test('the live swap script prints the steps and does not ask 1Click unless --live', () => {
  const r = spawnSync(process.execPath, ['backend/scripts/ferry-live-swap.js'], { cwd: new URL('../../..', import.meta.url), encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /0\.2 USD/);
  assert.match(r.stdout, /does not send funds/);
  assert.doesNotMatch(r.stdout + r.stderr, /depositAddress":/);
});
