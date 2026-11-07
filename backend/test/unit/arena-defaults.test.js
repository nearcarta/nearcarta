// Two "looks filled, refuses anyway" defects found by pressing the real buttons.
// 1. Arena's Oath cap / Pot / Entry fee / Creator split rendered their numbers as PLACEHOLDER
//    text, so the form looked complete while state held empty strings. Pressing Mint guardian
//    refused with "Set a cap, a pot, and a fee" on a form with all of them visible.
// 2. capNear and receivers read `S.clauses.pay`, a charter shape that a BOARD ROW does not
//    have, so Arena's mint was told to name an allow list it already had, and the cap check
//    saw no cap at all. Bank had the same blind spot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('Arena gives its money fields real values, not placeholders that look filled', () => {
  const tray = read('app/src/panels/arena/tray.js');
  for (const [name, dflt] of [['cap', '0.01'], ['pot', '0.04'], ['fee', '0.001'], ['split', '2000']]) {
    assert.match(tray, new RegExp(`input\\('${name}', state\\.${name} \\?\\? '${dflt.replace('.', '\\.')}'`),
      `${name} must carry a real default so the mint plan can read it`);
  }
});

test('the shop hooks read the board row, not only a charter clause', () => {
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /capNear: \(\) => \{\s*\n\s*const cap = A\.S\.boardRow\?\.per_action_cap \?\?/, 'cap comes from the live row first');
  assert.match(ui, /const fromRow = A\.S\.boardRow\?\.receivers;/, 'receivers come from the live row first');
  // Bank's cap hooks had the same gap.
  assert.match(ui, /capYocto: \(\) => A\.S\.boardRow\?\.per_action_cap/, 'Bank reads the row cap too');
});
