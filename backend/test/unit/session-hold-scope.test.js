// The session key's scope for the hold methods Arena, Guard and Hall need.
//
// The one rule that matters: the agent must never be able to confirm a WARN on its own.
// The contract enforces that with a separate confirm key that can never be the agent key
// (`set_confirm_key` requires `pk != agent`), and `confirm_hold` accepts only a signature
// from that stored key. This test pins both the scope we write and the contract check it
// depends on, so a future change to either one fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGENT_METHODS, SESSION_METHODS, OWNER_ONLY_METHODS, HOLD_METHODS,
  agentCanConfirmAlone, scopeHasOwnerOnly, agentMethodsReady, renewAgentKeyActions,
} from '../../../shared/board/session.js';
import { openRowTransactions } from '../../../shared/setup/open-row.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const contract = read('contracts/charter_board/src/v2.rs');

test('the session scope names every hold method the shops need', () => {
  for (const m of HOLD_METHODS) assert.ok(SESSION_METHODS.includes(m) || OWNER_ONLY_METHODS.includes(m), m);
  assert.ok(SESSION_METHODS.includes('confirm_hold'));
  // The agent's own authority is still propose, propose_call and propose_call_as.
  for (const m of AGENT_METHODS) assert.ok(SESSION_METHODS.includes(m), m);
});

test('cancel and expire are owner-only and never travel with the agent', () => {
  assert.deepEqual(OWNER_ONLY_METHODS, ['cancel_hold', 'expire_sent']);
  for (const m of OWNER_ONLY_METHODS) assert.equal(SESSION_METHODS.includes(m), false, `${m} must not be in the session key`);
  assert.equal(scopeHasOwnerOnly(SESSION_METHODS), false);
  // Both are predecessor == owner in the contract, so only the visitor's wallet can call them.
  for (const name of ['cancel_hold', 'expire_sent']) {
    const fn = contract.slice(contract.indexOf(`pub fn ${name}`), contract.indexOf(`pub fn ${name}`) + 700);
    assert.match(fn, /let (me|pred) = env::predecessor_account_id\(\)/, `${name} reads the predecessor`);
  }
});

test('the agent cannot confirm a WARN without the visitor', () => {
  // Listing confirm_hold on the session key is not enough on its own: the signature
  // must come from the row's confirm key, and that key can never be the agent key.
  assert.equal(agentCanConfirmAlone(SESSION_METHODS), false);
  assert.equal(agentCanConfirmAlone(SESSION_METHODS, { confirmKeyEqualsAgent: false }), false);
  // The contract check that makes it true. If someone deletes it, this fails.
  const setKey = contract.slice(contract.indexOf('pub fn set_confirm_key'), contract.indexOf('pub fn tighten_rules'));
  assert.match(setKey, /require!\(pk != agent, "ERR_CONFIRM"\)/, 'set_confirm_key refuses the agent key');
  const confirm = contract.slice(contract.indexOf('pub fn confirm_hold'), contract.indexOf('pub fn cancel_hold'));
  assert.match(confirm, /self\.confirm\.get\(&owner\)/, 'confirm_hold reads the stored confirm key');
  assert.match(confirm, /env::ed25519_verify\(/);
  assert.match(confirm, /msg\.as_bytes\(\), &key\)/, 'confirm_hold verifies against the stored key');
  assert.doesNotMatch(confirm, /row\.agent/, 'confirm_hold never checks the agent key');
});

test('/setup writes the session scope, not the agent methods, and never an owner-only method', () => {
  const setup = read('app/house/setup.js');
  assert.match(setup, /methodNames: \[\.\.\.SESSION_METHODS\]/);
  assert.match(setup, /methodNames: SESSION_METHODS/);
  assert.doesNotMatch(setup, /methodNames: \[\.\.\.AGENT_METHODS\]/);
  // The scope is on the sign step before the wallet opens, next to the caps.
  assert.match(setup, /data-testid="cap-key-scope"/);
  assert.match(setup, /data-testid="cap-holds"/);
  assert.match(setup, /cannot confirm it/);
});

test('a renewed key uses the same scope, so an old key is replaced by a hold-capable one', () => {
  const actions = renewAgentKeyActions({ stalePublicKeys: ['ed25519:old'], newPublicKey: 'ed25519:new', boardContract: 'board.nearcarta.near' });
  const add = actions.find(a => a.type === 'AddKey');
  assert.deepEqual(add.params.accessKey.permission.methodNames, [...SESSION_METHODS]);
  assert.equal(add.params.accessKey.permission.methodNames.includes('confirm_hold'), true);
  assert.equal(scopeHasOwnerOnly(add.params.accessKey.permission.methodNames), false);
});

test('the opened row key carries the same scope and no owner-only method', () => {
  const { key } = openRowTransactions({
    accountId: 'visitor.near', contract: 'board.nearcarta.near',
    rules: { receivers: ['toll.nearcarta.near'], daily_budget: '10000000000000000000000' },
    agentPublicKey: 'ed25519:K', fundYocto: '1', rowDepositYocto: '2', callsDepositYocto: '3',
    calls: [{ receiver: 'toll.nearcarta.near', method: 'ft_transfer', cap: '1' }],
    gasOpen: '1', gasAgent: '1', allowance: '1',
  });
  const names = key.actions[0].params.accessKey.permission.methodNames;
  assert.deepEqual(names, [...SESSION_METHODS]);
  assert.equal(scopeHasOwnerOnly(names), false);
  // A key that names every session method is ready; the old three-method key is stale.
  assert.equal(agentMethodsReady(names), true);
  assert.equal(agentMethodsReady(AGENT_METHODS), false);
  // Readiness compares against the session scope, so a key without confirm_hold is stale.
  assert.equal(agentMethodsReady(['propose', 'propose_call', 'propose_call_as']), false);
});
