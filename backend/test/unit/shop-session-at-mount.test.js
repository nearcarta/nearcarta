// A shop room must know who the visitor is as soon as it opens.
// The regression: `mount` only refreshed the session when `S.ready` was already true, so on a
// fresh city load every shop painted with an empty `S.me`. Toll showed "Sign in at /setup" to a
// signed-in visitor and its Pay button had no owner to price a crossing for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('opening a room always refreshes the session, not only when it was already ready', () => {
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.doesNotMatch(ui, /if \(A\.S\.ready\) A\.refresh\(\)/, 'a fresh city load has ready=false');
  assert.match(ui, /A\.refresh\(\)\.then\(\(\) => cur === id/, 'every mount refreshes and repaints');
});

test('refresh boots the wallet layer when a room opened before it finished', () => {
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /export async function refresh\(\) \{\n  \/\/ Open a room before/, 'refresh guards itself');
  assert.match(apps, /if \(!conn\) await init\(\(\) => \{\}\)/, 'it initialises the connector first');
});

test('the Toll tray takes the visitor at mount so the wallet words are not empty', () => {
  const room = read('app/src/panels/toll-room.js');
  assert.match(room, /if \(typeof hooks\.account === 'function'\) \{\n    const who = String\(hooks\.account\(\) \|\| ''\);/,
    'state.owner is filled at mount, not only on an action');
});
