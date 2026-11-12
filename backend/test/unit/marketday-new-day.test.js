// F25 (film 2026-11-12): Market Day resumed old local progress with no way to start over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../../app/src/market/city.js', import.meta.url), 'utf8');
const fn = src.slice(src.indexOf('function newDay'), src.indexOf("root.querySelector('.md-new')"));

test('the HUD has a visible Start a new day control, shown once a day has progress', () => {
  assert.match(src, /data-testid="md-newday"[^>]*>Start a new day</);
  assert.match(src, /nd\.hidden = pr\.done === 0; nd\.classList\.toggle\('gold', pr\.done >= pr\.total\)/);
});

test('a new day resets only the local quest keys and keeps the account and stall', () => {
  assert.match(src, /DAY_KEYS = Object\.freeze\(\[KEY, 'nearcarta\.marketday\.live'\]\)/);
  assert.match(fn, /city = S\.createCity\(\)/);
  assert.match(fn, /delete R\.live\.txs/);
  assert.doesNotMatch(fn, /delete R\.live\.(account|stall)/);
  // Never the guest, setup, vault, agent or Privy keys.
  assert.doesNotMatch(fn, /privy|nearcarta\.guest|nc_setup|vault|agent|localStorage\.clear/i);
});

test("'/?play=new' starts a fresh day on load and leaves '?play' in the address", () => {
  const m = src.slice(src.indexOf('function mount'), src.indexOf('if (document.readyState'));
  assert.match(m, /play=new/);
  assert.match(m, /newDay\(\{ quiet: true \}\)/);
  assert.match(m, /replace\(\/\(\[\?&\]\)play=new\\b\/, '\$1play'\)/);
});

test('a finished day offers a new day on the next visit', () => {
  const e = src.slice(src.indexOf('function enter'), src.indexOf('function leave'));
  assert.match(e, /if \(Q\.finished\(city\)\)[^\n]*Start a new day/);
});
