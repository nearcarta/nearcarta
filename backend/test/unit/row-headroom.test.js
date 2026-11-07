import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rowHeadroomBytes, ROW_STORAGE_BYTES } from '../../../shared/board/session.js';
const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('headroom comes from the chain storage_locked, not from a model of a fresh row', () => {
  // The live row on 2026-11-07 reported storage_locked of exactly 0.02 NEAR while the
  // pairBudgetBytes model still claimed 554 free bytes. set_rules then panicked
  // ERR_ROW_TOO_BIG after the visitor had already approved the wallet call.
  assert.equal(rowHeadroomBytes({ storage_locked: '20000000000000000000000' }), 0);
  assert.equal(rowHeadroomBytes({ storage_locked: '17940000000000000000000' }), 206);
  assert.equal(rowHeadroomBytes({}), null, 'an unknown row must not be guessed');
  assert.equal(ROW_STORAGE_BYTES, 2000);
});

test('the rules step refuses a full row before the wallet opens', () => {
  const setup = read('app/house/setup.js');
  assert.match(setup, /rowHeadroomBytes\(chainRow\)/, 'it reads the chain number');
  assert.match(setup, /This row is full: its 0\.02 NEAR of storage is all used/);
  // A cap-only edit does not grow the row, so it must still be allowed.
  assert.match(setup, /const adds = r\.receivers\.some\(a => !known\.has\(String\(a\)\)\)/);
  assert.match(setup, /room === 0 && adds/);
  // and it must come before the wallet work, i.e. inside the rules step validator
  assert.ok(setup.indexOf('This row is full') < setup.indexOf('function signBoard'));
});

test('the chain row is marked loaded only after it arrives', () => {
  const setup = read('app/house/setup.js');
  // Setting chainLoadedFor before the await made the next caller return early with
  // chainRow still null, so a storage-full row was never refused.
  const fn = setup.slice(setup.indexOf('async function ensureChainRow'), setup.indexOf('async function facts'));
  const awaitAt = fn.indexOf('await viewFn');
  const markAt = fn.indexOf('chainLoadedFor = owner');
  assert.ok(awaitAt > 0 && markAt > awaitAt, 'the flag must be set after the read resolves');
  assert.ok(!/chainLoadedFor = owner;[\s\S]{0,80}await viewFn/.test(fn), 'never before');
});
