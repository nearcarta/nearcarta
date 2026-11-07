import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('the rules step reads the shop field at commit, not only from cached state', () => {
  const setup = read('app/house/setup.js');
  // A list typed or pasted without an `input` event was ignored and the row kept its old
  // receivers: the visitor saw their edit in the box and the chain never got it.
  assert.match(setup, /const field = typeof document !== 'undefined' \? document\.getElementById\('rcv'\) : null/,
    'the live field is consulted');
  assert.match(setup, /const useTyped = typed\.length > 0/, 'and wins when it has entries');
});

test('the shop field also commits on change and blur', () => {
  const setup = read('app/house/setup.js');
  assert.match(setup, /el\.oninput = upd;[\s\S]{0,120}el\.onchange = upd;[\s\S]{0,60}el\.onblur = upd;/);
});
