// Guard's release half: a held WARN is released only by a confirm key that is not the agent
// key. Before this, nothing ever minted one, so a hold could never be released from the UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('setup mints a confirm key, persists it separately from the agent key and registers it', () => {
  const setup = read('app/house/setup.js');
  // A different secret, under its own storage key.
  assert.match(setup, /nearcarta\.vault\.confirm\./);
  assert.match(setup, /const confirmKeyFor = id =>/);
  // Registered on the board in the same approval as the agent key.
  assert.match(setup, /methodName: 'set_confirm_key'/);
  assert.match(setup, /setConfirmAction\(confirmKeyFor\(me\)\)/);
  // The agent key must never be reused as the confirm key: the contract refuses that.
  assert.doesNotMatch(setup, /setConfirmAction\(keyFrom\(sec\)\)/);
});

test('the guard reads the stored confirm key instead of an unset global', () => {
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /function confirmKeyNow\(\)/, 'a real reader for the confirm key');
  assert.match(apps, /nearcarta\.vault\.confirm\.' \+ S\.me/, 'it reads the key setup stored');
  // The regression: confirming with nothing set fell through to "the confirm key is not loaded".
  assert.doesNotMatch(apps, /if \(kind === 'confirm'\) return globalThis\.__guardConfirmKey \|\| null;/);
});

test('a confirm signature is built from the board text and the confirm key', () => {
  const live = read('app/src/panels/guard-live.js');
  assert.match(live, /boardView\('confirm_message'/, 'the exact text comes from the board');
  assert.match(live, /signText\(key, text\)/, 'the confirm key signs it');
  assert.match(live, /GUARD_METHODS\.confirm/, 'and the signed text goes to confirm_hold');
});
