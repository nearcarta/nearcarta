// The simulate route: a free "would this be allowed?" read.
//
// Why this test exists: the read must never be mistaken for permission. A board build that has
// no simulate view answers MethodNotFound, and turning that into ok:true would let an agent
// believe a call is allowed when nobody checked it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');

test('the simulate route never reads a missing view as allowed', () => {
  const at = src.indexOf("app.post('/api/board/simulate'");
  assert.ok(at > 0, 'the route exists');
  const body = src.slice(at, src.indexOf('app.get(', at));
  // A method the build does not have answers ok:null, never ok:true.
  assert.match(body, /MethodNotFound\|no such method/, 'a missing view is recognised');
  assert.match(body, /ok: null/, 'and answered as unknown');
  assert.doesNotMatch(body, /ok: true,?\s*answer: null/, 'never invents permission');
  // Nothing is signed and nothing moves.
  assert.doesNotMatch(body, /signTx|signAndSendTransaction|send_tx/, 'the route must not send');
  // Only the board view is called.
  assert.match(body, /view\(board, 'simulate'/, 'it reads the contract view');
});
