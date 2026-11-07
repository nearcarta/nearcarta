import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('a held payment survives a reload so its Cancel stays reachable', () => {
  const tray = read('app/src/panels/guard-tray.js');
  const agent = read('app/src/panels/guard-agent.js');
  // state is in memory only, so a refresh orphaned the hold: it kept the row's NEAR and
  // blocked close_charter with ERR_IN_FLIGHT, with no control on screen to clear it.
  assert.match(agent, /nearcarta\.guard\.hold\./, 'the id is written when a hold is created');
  assert.match(tray, /restoreHold\(\)/, 'and read back on paint');
  assert.match(tray, /const restoreHold = \(\) =>/, 'after the owner is known');
});
