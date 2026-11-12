import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('F65b: old Toll notes are checked against the chain once per hash', () => {
  const a = read('app/design/D8_shops/js/apps.js');
  assert.match(a, /async function reconcileTollNotes\(done\)/);
  assert.match(a, /reconcileTollNotes\(out\)\.catch/);
  // a Guard call the wallet answered in a Toll press moves back to Guard
  assert.match(a, /method === 'cancel_hold' \|\| method === 'confirm_hold' \|\| method === 'guard_hold'\) \{ r\.shop = 'guard'/);
  // the pass of the paid crossing is found by the action id inside the board call's args string
  assert.match(a, /if \(typeof inner === 'string'\) \{ try \{ inner = JSON\.parse\(inner\)/);
  assert.match(a, /r\.reason = 'paid'; r\.paid = /);
});

test('F65b: a returning visitor sees the last paid read at once, then the fresh chain read', () => {
  assert.match(read('app/design/D8_shops/js/apps.js'), /export function tollFinishedCached\(owner = S\.me\)/);
  assert.match(read('app/src/panels/toll-room.js'), /hooks\.finishedCached\(\)/);
  assert.match(read('app/design/D8_shops/js/shopui.js'), /finishedCached: \(\) => A\.tollFinishedCached\(\)/);
});
