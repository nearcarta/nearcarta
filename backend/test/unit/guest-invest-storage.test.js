// Fresh-guest proof 2026-11-12 (prod 43461ccb): the House invest was refused ERR_PRECHECK_STORAGE on the
// first press. The guest path tops up the market storage before the extra salt run, which then uses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../../app/src/market/live-guest.js', import.meta.url), 'utf8');

test('a storage refusal tops up through the relayer and tries the move again', () => {
  assert.match(src, /ERR_PRECHECK_\(BAG\|PURSE\|STORAGE\)\|ERR_NONCE/);
  assert.match(src, /if \(e\.code === 'ERR_PRECHECK_STORAGE'\) await ensureSession\(\)/);
});

test('the guest invest tops the storage up again after the extra salt run', () => {
  const inv = src.slice(src.indexOf("if (id === 'invest') {"), src.indexOf("action: 'invest'"));
  assert.ok(inv.indexOf('topUpPurse()') < inv.lastIndexOf('await ensureSession()'), 'ensureSession runs after topUpPurse');
});
