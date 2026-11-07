import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('cancel_hold goes through the visitor wallet, not the session key', () => {
  const apps = read('app/design/D8_shops/js/apps.js');
  const fn = apps.slice(apps.indexOf('export async function guardCancel'), apps.indexOf('export async function guardExpire'));
  // cancel_hold is OWNER_ONLY on chain and SESSION_METHODS must never carry it, so the old
  // session-key path could only ever fail with key_cannot_cancel_hold.
  assert.match(fn, /await sign\(S\.board, \[fc\('cancel_hold'/, 'signs with the wallet');
  assert.doesNotMatch(fn, /guardSend\(\{ action: 'cancel'/, 'not through the session sender');
});

test('the session key still cannot cancel its own hold', () => {
  const session = read('shared/board/session.js');
  const owner = read('backend/test/unit/session-hold-scope.test.js');
  assert.match(session, /export const OWNER_ONLY_METHODS = \['cancel_hold', 'expire_sent'\]/);
  assert.match(owner, /scopeHasOwnerOnly\(SESSION_METHODS\), false/);
});
