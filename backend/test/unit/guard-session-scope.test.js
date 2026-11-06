import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_METHODS, OWNER_ONLY_METHODS, SESSION_METHODS, agentCanConfirmAlone, scopeHasOwnerOnly,
} from '../../../shared/board/session.js';

test('the session may list confirm_hold, and the agent still cannot confirm alone', () => {
  // A session key that lists confirm_hold is safe: the board stores a separate confirm key,
  // set_confirm_key refuses pk == agent, and confirm_hold accepts only a signature from that
  // stored key. Guard's executor reflects it: confirm signs with the confirm key, never the
  // agent key (backend/test/unit/guard-live.test.js, "confirm needs the confirm key").
  assert.ok(SESSION_METHODS.includes('confirm_hold'));
  assert.ok(AGENT_METHODS.includes('propose_call_as'), 'the open path is the agent key\'s');
  assert.equal(agentCanConfirmAlone(SESSION_METHODS), false, 'listing the method is not enough');
  assert.equal(agentCanConfirmAlone(SESSION_METHODS, { confirmKeyEqualsAgent: true }), true, 'only a same-key setup would be unsafe');
});

test('cancel and expire stay with the visitor wallet', () => {
  // Both are predecessor == owner in the contract, and an agent that could cancel a WARN
  // could quietly undo it. They are never in a session key's list.
  assert.deepEqual(OWNER_ONLY_METHODS, ['cancel_hold', 'expire_sent']);
  for (const m of OWNER_ONLY_METHODS) {
    assert.equal(SESSION_METHODS.includes(m), false, `${m} must not be in a session key`);
    assert.equal(AGENT_METHODS.includes(m), false, `${m} must not be in the agent scope`);
  }
  assert.equal(scopeHasOwnerOnly(SESSION_METHODS), false);
  assert.equal(scopeHasOwnerOnly([...SESSION_METHODS, 'cancel_hold']), true);
});
