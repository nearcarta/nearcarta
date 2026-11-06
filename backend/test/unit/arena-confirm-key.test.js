// The visitor's confirm key, and the rule it exists to enforce: a held action is released
// by a human, never by the agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmLS, confirmKeyFor, hasConfirmKey, setConfirmKeyAction, CONFIRM_SCOPE } from '../../../app/house/confirm-key.js';
import { CONFIRM_KEY_METHODS, SESSION_METHODS, agentCanConfirmAlone, confirmKeyIsAgent } from '../../../shared/board/session.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const contract = read('contracts/charter_board/src/v2.rs');

function memoryStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), _m: m };
}

const makeKey = () => ({ secretKey: 'ed25519:confirm-secret', publicKey: 'ed25519:5Z4fW1zP1G8kQm8m9Lk2sQ2mVv9VQyYc7YbQ2hKk2mVv' });

test('the confirm key is stored away from the agent key', () => {
  assert.notEqual(confirmLS('visitor.near'), 'nearcarta.vault.agent.visitor.near');
  const store = memoryStore();
  assert.equal(hasConfirmKey('visitor.near', store), false);
  const secret = confirmKeyFor('visitor.near', { agentSecret: 'ed25519:agent-secret', makeKey, store });
  assert.equal(secret, 'ed25519:confirm-secret');
  store.setItem(confirmLS('visitor.near'), secret);
  assert.equal(hasConfirmKey('visitor.near', store), true);
});

test('a confirm key that equals the agent key is refused here, as on chain', () => {
  const store = memoryStore();
  const same = () => ({ secretKey: 'ed25519:agent-secret', publicKey: 'ed25519:same' });
  assert.throws(
    () => confirmKeyFor('visitor.near', { agentSecret: 'ed25519:agent-secret', makeKey: same, store }),
    /may not be the agent key/,
  );
  // And the contract refuses it too, so the page and the chain agree.
  const setKey = contract.slice(contract.indexOf('pub fn set_confirm_key'), contract.indexOf('pub fn tighten_rules'));
  assert.match(setKey, /require!\(pk != agent, "ERR_CONFIRM"\)/);
});

test('the confirm key is registered with set_confirm_key, 0 deposit, one method', () => {
  const action = setConfirmKeyAction('ed25519:5Z4fW1zP1G8kQm8m9Lk2sQ2mVv9VQyYc7YbQ2hKk2mVv');
  assert.equal(action.type, 'FunctionCall');
  assert.equal(action.params.methodName, 'set_confirm_key');
  assert.equal(action.params.deposit, '0');
  assert.deepEqual(Object.keys(action.params.args), ['key']);
  assert.deepEqual([...CONFIRM_SCOPE], [...CONFIRM_KEY_METHODS]);
  assert.deepEqual([...CONFIRM_SCOPE], ['confirm_hold']);
});

test('the confirm scope is not the agent scope, and the agent still cannot confirm alone', () => {
  for (const m of CONFIRM_SCOPE) assert.equal(SESSION_METHODS.includes(m), true, `${m} is listed for the visitor's confirm key`);
  for (const m of ['propose_call_as', 'propose', 'propose_call']) assert.equal(CONFIRM_SCOPE.includes(m), false, `the confirm key cannot ${m}`);
  assert.equal(agentCanConfirmAlone(CONFIRM_SCOPE, { confirmKeyEqualsAgent: false }), false);
  assert.equal(confirmKeyIsAgent('ed25519:a', 'ed25519:a'), true);
});
