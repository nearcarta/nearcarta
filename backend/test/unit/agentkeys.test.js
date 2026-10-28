import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyPlan, keyToAdd } from '../../../shared/vault/agentkeys.js';

const A = 'ed25519:A', B = 'ed25519:B', C = 'ed25519:C';

test('a pending key is promoted once it is on chain, and is then the live key', () => {
  const p = keyPlan({ onChain: [B], current: B, held: A, pend: B });
  assert.deepEqual(p, { promote: true, mine: B, keyLive: true, pendWaiting: false, pendLost: false, revocable: [], stray: [] });
});

test('a live held key with no pending key: nothing to clean up', () => {
  assert.deepEqual(keyPlan({ onChain: [A], current: A, held: A }),
    { promote: false, mine: A, keyLive: true, pendWaiting: false, pendLost: false, revocable: [], stray: [] });
});

test('a pending key waiting in the timelock is kept, and is not an orphan', () => {
  const p = keyPlan({ onChain: [A], current: A, held: A, pend: B, queued: [B] });
  assert.deepEqual([p.promote, p.keyLive, p.pendWaiting, p.pendLost, p.revocable, p.stray], [false, true, true, false, [], []]);
});

test('a pending key that never reached the chain is reported lost', () => {
  const p = keyPlan({ onChain: [], current: null, held: null, pend: B });
  assert.deepEqual([p.promote, p.keyLive, p.pendWaiting, p.pendLost], [false, false, false, true]);
});

test('the charter key this browser does not hold is revocable (redirect wallet lost it)', () => {
  const p = keyPlan({ onChain: [C], current: C, held: null, pend: null });
  assert.deepEqual([p.keyLive, p.revocable, p.stray], [false, [C], []]);
});

test('a key that is not get_state.agent_key is never offered for revoke (revoke_agent would delete the live key)', () => {
  const p = keyPlan({ onChain: [A, C], current: A, held: A });
  assert.deepEqual([p.keyLive, p.revocable, p.stray], [true, [], [C]]);
});

test('a held key that is gone from chain is not live', () => {
  const p = keyPlan({ onChain: [], current: null, held: A });
  assert.equal(p.keyLive, false);
  assert.equal(keyPlan().keyLive, false);
});

test('the next set_agent_key reuses the saved pending key, else makes a new one', () => {
  let made = 0;
  assert.equal(keyToAdd('ed25519:secretP', () => { made++; return 'new'; }), 'ed25519:secretP');
  assert.equal(made, 0);
  assert.equal(keyToAdd(null, () => { made++; return 'new'; }), 'new');
  assert.equal(made, 1);
});
