import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_METHODS, GUARD_HOLD_METHODS, GUARD_SESSION_METHODS } from '../../../shared/board/session.js';

test('the agent key cannot confirm or cancel a hold', () => {
  // The whole guard design rests on this: a key that can call confirm_hold can release a
  // warning, and confirm_hold has no predecessor check (the confirm-key signature is the
  // boundary). So the hold lifecycle is a separate scope, never part of AGENT_METHODS.
  for (const m of GUARD_HOLD_METHODS) {
    assert.equal(AGENT_METHODS.includes(m), false, `${m} must not be in the agent scope`);
  }
  assert.deepEqual(GUARD_HOLD_METHODS, ['confirm_hold', 'cancel_hold', 'expire_sent']);
  assert.deepEqual(GUARD_SESSION_METHODS, [...AGENT_METHODS, ...GUARD_HOLD_METHODS]);
  // The open path stays in the agent scope: Pay through guard has to send propose_call_as.
  assert.ok(AGENT_METHODS.includes('propose_call_as'));
});
