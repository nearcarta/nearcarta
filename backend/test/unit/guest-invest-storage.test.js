// Fresh-guest proofs 2026-11-12: the House invest was refused ERR_PRECHECK_STORAGE on the first press
// (43461ccb, then again on 715f1e11 in the film take, F52).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../../app/src/market/live-guest.js', import.meta.url), 'utf8');

test('a storage refusal waits for the storage, and does not hammer the rate-limited session', () => {
  assert.match(src, /ERR_PRECHECK_\(BAG\|PURSE\|STORAGE\)\|ERR_NONCE/);
  assert.match(src, /if \(e\.code === 'ERR_PRECHECK_STORAGE'\) await ensureStorage\(\)/);
  assert.match(src, /Date\.now\(\) - lastSession > 8000/);
});

test('ensureStorage asks the relayer only when low, then polls until the chain shows it', () => {
  const fn = src.slice(src.indexOf('export async function ensureStorage'), src.indexOf('/**\n * Open the guest'));
  assert.ok(fn.indexOf('have >= min') < fn.indexOf('ensureSession()'), 'reads first');
  assert.match(fn, /for \(let i = 0; i < wait; i\+\+\)/);
});

test('the guest invest tops the storage up again after the extra salt run', () => {
  const inv = src.slice(src.indexOf("if (id === 'invest') {"), src.indexOf("action: 'invest'"));
  assert.ok(inv.indexOf('topUpPurse()') < inv.lastIndexOf('await ensureStorage()'), 'ensureStorage runs after topUpPurse');
});
