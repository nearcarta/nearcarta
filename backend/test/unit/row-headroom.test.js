import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rowHeadroomBytes, ROW_STORAGE_BYTES } from '../../../shared/board/session.js';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };
const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('headroom comes from the chain storage_locked, not from a model of a fresh row', () => {
  // The live row on 2026-11-07 reported storage_locked of exactly 0.02 NEAR while the
  // pairBudgetBytes model still claimed 554 free bytes. set_rules then panicked
  // ERR_ROW_TOO_BIG after the visitor had already approved the wallet call.
  // The live board (code 51kKGvtV…) caps a row at 0.04 NEAR = 4000 bytes.
  assert.equal(rowHeadroomBytes({ storage_locked: '40000000000000000000000' }), 0);
  assert.equal(rowHeadroomBytes({ storage_locked: '37940000000000000000000' }), 206);
  // The live eight-receiver row 8ccd5d33 locks 0.03469 NEAR, so 531 bytes are left.
  assert.equal(rowHeadroomBytes({ storage_locked: '34690000000000000000000' }), 531);
  assert.equal(rowHeadroomBytes({}), null, 'an unknown row must not be guessed');
  assert.equal(ROW_STORAGE_BYTES, 4000);
  // and the page budget is the same number the chain reports
  assert.equal(ROW_STORAGE_BYTES * 1e19, Number(MAIN.board.max_row_yocto));
});

test('the rules step refuses a full row before the wallet opens', () => {
  const setup = read('app/house/setup.js');
  assert.match(setup, /rowHeadroomBytes\(chainRow\)/, 'it reads the chain number');
  assert.match(setup, /This row is full: its \$\{fmtN\(ROW_NEAR\)\} NEAR of storage is all used/);
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

test('the rules step reads the chain row itself', () => {
  const setup = read('app/house/setup.js');
  // ensureChainRow used to run only on the Sign step, so the rules guard had no row to look
  // at and skipped itself. The rules step must trigger the read too.
  assert.match(setup, /STEPS\[st\.step\]\[0\] === 'rules' && boardLive\(\) && !st\.trial && !chainRow/);
  assert.match(setup, /ensureChainRow\(\)\.then\(\(\) => \{ if \(STEPS\[st\.step\]\[0\] === 'rules'\) render\(\); \}\)/);
});

test('a full row rewrites the call list before the rules so a new shop can fit', () => {
  const setup = read('app/house/setup.js');
  // set_calls frees the old pairs; set_rules then spends the difference. Measured on the live
  // row: 187 bytes freed, a receiver costs about 70.
  assert.match(setup, /const shrinkFirst = roomFull && addingShop/);
  assert.match(setup, /const rank = k => \(k === 'calls' \? 0 : k === 'rules' \? 1 : 2\)/);
  // and the refusal must now be arithmetic, not "any add on a full row"
  assert.match(setup, /if \(freed < need \+ 24\)/);
});
