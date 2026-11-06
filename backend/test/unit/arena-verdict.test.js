// Arena's signed verdict and its send paths.
//
// Two things must not drift, and both are pinned here:
//  1. The text the model signs. contracts/arena_v2 rebuilds it in `verdict_text`; this
//     test reads that function and checks it emits the same order and separators, so the
//     browser can never sign bytes the chain will not accept.
//  2. Who may sign what. The agent keys can propose, but only the visitor's confirm key
//     can confirm a held attack, and only the row owner's wallet can cancel or expire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERDICT_PREFIX, verdictFor, verdictShape, verdictText } from '../../../shared/arena/verdict.js';
import {
  ARENA_KEY_FOR, ARENA_METHODS, agentArenaSend, agentMaySend, arenaSend, createArenaLedger,
  holdExpiryAt, resolveArgs, visitorHoldAction,
} from '../../../app/src/panels/arena/arena-live.js';
import {
  CONFIRM_KEY_METHODS, HUMAN_INTENT_METHODS, SESSION_METHODS, OWNER_ONLY_METHODS,
  agentCanConfirmAlone, confirmKeyIsAgent, needsHumanIntent, scopeHasOwnerOnly,
} from '../../../shared/board/session.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const contract = read('contracts/arena_v2/src/lib.rs');

const OWNER = 'visitor.near';
const ARENA = 'arena.nearcarta.near';
const row = { nonce: '4', epoch: '2', frozen: false };

function harness({ keys = { agent: 'agent-key', confirm: 'confirm-key', owner: 'owner-key' }, row: r = row } = {}) {
  const sent = [];
  const views = [];
  return {
    sent,
    views,
    deps: {
      row: r,
      ledger: createArenaLedger(),
      boardView: async (method, args) => { views.push([method, args]); return method === 'call_as_message' ? 'board-call-as-v1|…|exec' : 'board-confirm-v1|…'; },
      signText: (key, text) => `sig(${key}:${text.slice(0, 12)})`,
      keyFor: kind => keys[kind] ?? null,
      send: async (method, args) => { sent.push([method, args]); return { ok: true, tx: 'TX' + sent.length, reason: 'ok' }; },
    },
  };
}

test('the browser verdict text matches the contract, field for field', () => {
  const ours = verdictText({
    contract: ARENA, attemptId: 7, player: OWNER, guardianId: 1,
    promptHash: 'p'.repeat(64), oathHash: 'o'.repeat(64), personaHash: 'e'.repeat(64),
    responseHash: 'r'.repeat(64), payTo: 'prize.near', payAmount: '1000', model: 'z-ai/glm-5.3-flash',
  });
  assert.equal(ours, [
    'nearcarta.arena.verdict.v1', 'mainnet', ARENA, '7', OWNER, '1',
    'p'.repeat(64), 'o'.repeat(64), 'e'.repeat(64), 'r'.repeat(64),
    'prize.near', '1000', 'z-ai/glm-5.3-flash',
  ].join('|'));
  // The contract's formatter must use the same literal prefix and the same 13 fields in
  // the same order, joined by '|'. Read the source so a rename or a reorder fails here.
  const fn = contract.slice(contract.indexOf('pub fn verdict_text'), contract.indexOf('fn verify_verdict'));
  assert.match(fn, /VERDICT_PREFIX/);
  assert.match(contract, /const VERDICT_PREFIX: &str = "nearcarta\.arena\.verdict\.v1";/);
  assert.match(contract, /const NETWORK: &str = "mainnet";/);
  assert.equal((fn.match(/\{\}/g) || []).length, 13, 'the contract formats thirteen fields');
  for (const field of ['contract', 'attempt.id', 'envelope.player', 'attempt.guardian_id', 'attempt.prompt_hash',
    'attempt.oath_hash', 'attempt.persona_hash', 'envelope.response_hash', 'pay_to', 'envelope.pay_amount.0', 'self.model_name']) {
    assert.ok(fn.includes(field), `the contract text carries ${field}`);
  }
});

test('a verdict is a different string for a different round, player, amount or model', () => {
  const base = { contract: ARENA, attemptId: 7, player: OWNER, guardianId: 1, promptHash: 'p', oathHash: 'o', personaHash: 'e', responseHash: 'r', payTo: 'prize.near', payAmount: '1', model: 'm' };
  const text = verdictText(base);
  assert.notEqual(text, verdictText({ ...base, attemptId: 8 }));
  assert.notEqual(text, verdictText({ ...base, player: 'other.near' }));
  assert.notEqual(text, verdictText({ ...base, payAmount: '2' }));
  assert.notEqual(text, verdictText({ ...base, model: 'cheap' }));
  assert.notEqual(text, verdictText({ ...base, responseHash: 'zz' }));
  // An attempt record maps onto the same text.
  const attempt = { id: 7, player: OWNER, guardian_id: 1, prompt_hash: 'p', oath_hash: 'o', persona_hash: 'e' };
  assert.equal(verdictFor(attempt, { contract: ARENA, responseHash: 'r', payTo: 'prize.near', payAmount: '1', model: 'm' }), text);
});

test('the verdict shape check refuses a non-arena text, a wrong algorithm, and a short signature', () => {
  const good = { text: VERDICT_PREFIX + '|mainnet|x', signature: 'a'.repeat(128), signingAlgo: 'ed25519' };
  assert.equal(verdictShape(good).ok, true);
  assert.equal(verdictShape({ ...good, text: 'board-call-as-v1|x' }).ok, false);
  assert.equal(verdictShape({ ...good, signingAlgo: 'ecdsa' }).ok, false);
  assert.equal(verdictShape({ ...good, signature: 'abc' }).ok, false);
  assert.deepEqual(verdictShape(good).problems, []);
});

const mintPlan = { call: { boardMethod: 'propose_call_as', receiver: ARENA, method: 'mint', args: '{"title":"Lamp"}', deposit: '5', expiry: holdExpiryAt(), effects: [], hold: false } };
const attackPlan = { call: { boardMethod: 'propose_call_as', receiver: ARENA, method: 'open_attempt', args: '{"guardian_id":1}', deposit: '5', expiry: holdExpiryAt(), effects: [], hold: true } };

test('a mint signs with the agent key through the board call message', async () => {
  const h = harness();
  const out = await arenaSend({ action: 'mint', plan: mintPlan, row, owner: OWNER, arena: ARENA }, h.deps);
  assert.equal(out.ok, true);
  assert.equal(out.signed, true);
  assert.equal(out.key, 'agent');
  assert.equal(out.hold, false);
  assert.equal(h.views[0][0], 'call_as_message', 'the board supplies the exact bytes');
  assert.equal(h.sent[0][0], 'propose_call_as');
  assert.equal(h.sent[0][1].hold, false);
});

test('an attack holds the fee and says held, not paid', async () => {
  const h = harness();
  const out = await arenaSend({ action: 'attack', plan: attackPlan, row, owner: OWNER, arena: ARENA }, h.deps);
  assert.equal(out.ok, true);
  assert.equal(out.hold, true);
  assert.equal(h.sent[0][1].hold, true);
});

test('the same attempt is sent once; a second click does not sign', async () => {
  const h = harness();
  const first = await arenaSend({ action: 'attack', plan: attackPlan, row, owner: OWNER, arena: ARENA }, h.deps);
  const second = await arenaSend({ action: 'attack', plan: attackPlan, row, owner: OWNER, arena: ARENA }, h.deps);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.signed, false);
  assert.equal(h.sent.length, 1, 'only one transaction was sent');
});

test('the agent path can never confirm, cancel or expire', async () => {
  // A model that asks to confirm produces this call. It is refused before any key lookup.
  for (const action of ['confirm', 'cancel', 'expire']) {
    assert.equal(agentMaySend(action), false, `${action} is not an agent action`);
    const h = harness();
    const out = await agentArenaSend({ action, holdId: '3', row, owner: OWNER, arena: ARENA }, h.deps);
    assert.equal(out.ok, false, `${action} is refused for the agent`);
    assert.equal(out.signed, false);
    assert.equal(out.agentRefused, true);
    assert.equal(h.sent.length, 0, `${action} sent nothing`);
    assert.equal(h.views.length, 0, `${action} did not even ask the board`);
  }
});

test('the agent cannot opt itself into human intent', async () => {
  // agentArenaSend ignores a caller-supplied humanIntent, so a forged flag changes nothing.
  const h = harness();
  const out = await agentArenaSend({ action: 'confirm', holdId: '3', row, owner: OWNER, arena: ARENA, humanIntent: true }, h.deps);
  assert.equal(out.ok, false);
  assert.equal(h.sent.length, 0);
});

test('the visitor button path releases a hold with the confirm key', async () => {
  const h = harness();
  const out = await visitorHoldAction({ action: 'confirm', holdId: '3', row, owner: OWNER, arena: ARENA }, h.deps);
  assert.equal(out.ok, true);
  assert.equal(out.key, 'confirm');
  assert.equal(h.sent[0][0], 'confirm_hold');
});

test('a mint through the agent path still works, so the gate is only on holds', async () => {
  const h = harness();
  const out = await agentArenaSend({ action: 'mint', plan: mintPlan, row, owner: OWNER, arena: ARENA }, h.deps);
  assert.equal(out.ok, true);
  assert.equal(h.sent[0][0], 'propose_call_as');
});

test('confirm signs with the confirm key and never the agent key', async () => {
  const h = harness();
  const out = await visitorHoldAction({ action: 'confirm', holdId: '3', row, owner: OWNER, arena: ARENA }, h.deps);
  assert.equal(out.ok, true);
  assert.equal(out.key, 'confirm');
  assert.equal(h.views[0][0], 'confirm_message');
  assert.equal(h.sent[0][0], 'confirm_hold');
  assert.match(h.sent[0][1].signature, /confirm-key/, 'the confirm key signed it');
  assert.doesNotMatch(h.sent[0][1].signature, /agent-key/);
});

test('without a confirm key in the browser, a hold is not released', async () => {
  const h = harness({ keys: { agent: 'agent-key' } });
  const out = await visitorHoldAction({ action: 'confirm', holdId: '3', row, owner: OWNER, arena: ARENA }, h.deps);
  assert.equal(out.ok, false);
  assert.match(out.why, /confirm key is not in this browser/);
  assert.equal(h.sent.length, 0);
});

test('cancel refunds once and expire needs the owner wallet', async () => {
  const h = harness();
  const one = await visitorHoldAction({ action: 'cancel', holdId: '3', row, owner: OWNER, arena: ARENA }, h.deps);
  const two = await visitorHoldAction({ action: 'cancel', holdId: '3', row, owner: OWNER, arena: ARENA }, h.deps);
  assert.equal(one.ok, true);
  assert.equal(two.duplicate, true);
  assert.equal(h.sent.length, 1, 'one cancel only');
  assert.deepEqual(h.sent[0], ['cancel_hold', { action_id: '3' }]);
  const noOwner = harness({ keys: { agent: 'agent-key', confirm: 'confirm-key' } });
  const expire = await visitorHoldAction({ action: 'expire', holdId: '3', row, owner: OWNER, arena: ARENA }, noOwner.deps);
  assert.equal(expire.ok, false);
  assert.match(expire.why, /Connect the visitor wallet/);
});

test('a frozen row or a missing row refuses before signing', async () => {
  const frozen = harness({ row: { nonce: '4', frozen: true } });
  const a = await arenaSend({ action: 'mint', plan: mintPlan, row: { nonce: '4', frozen: true }, owner: OWNER, arena: ARENA }, frozen.deps);
  assert.equal(a.ok, false);
  assert.match(a.why, /frozen/);
  const none = harness();
  const b = await arenaSend({ action: 'mint', plan: mintPlan, row: null, owner: OWNER, arena: ARENA }, none.deps);
  assert.equal(b.ok, false);
  assert.match(b.why, /Finish \/setup/);
  assert.equal(none.sent.length + frozen.sent.length, 0);
});

test('a plan for another account is refused', async () => {
  const h = harness();
  const other = { ...mintPlan, call: { ...mintPlan.call, receiver: 'not-arena.near' } };
  const out = await arenaSend({ action: 'mint', plan: other, row, owner: OWNER, arena: ARENA }, h.deps);
  assert.equal(out.ok, false);
  assert.equal(h.sent.length, 0);
});

test('the session scope names the four board methods and keeps cancel/expire with the owner', () => {
  // The Arena needs propose_call_as (agent) and confirm_hold (visitor's confirm key).
  assert.ok(SESSION_METHODS.includes('propose_call_as'));
  assert.ok(SESSION_METHODS.includes('confirm_hold'));
  // cancel_hold and expire_sent are the visitor's own record, never the agent's.
  for (const m of OWNER_ONLY_METHODS) assert.equal(SESSION_METHODS.includes(m), false, `${m} stays off the agent key`);
  // And the invariant the whole hold design rests on: the agent cannot confirm alone.
  assert.equal(agentCanConfirmAlone(SESSION_METHODS), false);
  // Exactly one method per action, named once.
  assert.deepEqual(Object.values(ARENA_METHODS), ['propose_call_as', 'confirm_hold', 'cancel_hold', 'expire_sent']);
});

test('the human-intent scope is one confirm method and never an agent method', () => {
  // confirm_hold is the only method a human-intent signature covers, and its key may not
  // be the agent key: the board refuses `pk == agent`, and this page check repeats it.
  assert.deepEqual([...HUMAN_INTENT_METHODS], ['confirm_hold']);
  assert.deepEqual([...CONFIRM_KEY_METHODS], ['confirm_hold']);
  for (const m of HUMAN_INTENT_METHODS) {
    assert.equal(agentCanConfirmAlone([m], { confirmKeyEqualsAgent: false }), false);
    assert.equal(scopeHasOwnerOnly([m]), false, `${m} is not an owner-only wallet method`);
  }
  assert.equal(needsHumanIntent('confirm_hold'), true);
  for (const m of ['propose_call_as', 'mint', 'open_attempt', 'cancel_hold', 'expire_sent']) {
    assert.equal(needsHumanIntent(m), false, `${m} is not a human-intent method`);
  }
  assert.equal(confirmKeyIsAgent('ed25519:same', 'ed25519:same'), true);
  assert.equal(confirmKeyIsAgent('ed25519:confirm', 'ed25519:agent'), false);
  assert.equal(confirmKeyIsAgent('', ''), false);
});

test('resolve args carry the signed envelope the contract checks', () => {
  const envelope = {
    attempt_id: 7, player: OWNER, prompt_hash: 'p', oath_hash: 'o', persona_hash: 'e',
    response_hash: 'r', nonce: 7, pay_to: 'prize.near', pay_amount: '1000',
    model: 'z-ai/glm-5.3-flash', completion_id: 'chatcmpl-1', signature: 'a'.repeat(128), response: 'reply',
  };
  const args = resolveArgs({ envelope });
  assert.equal(args.envelope.attempt_id, 7);
  assert.equal(args.envelope.pay_amount, '1000', 'U128 is a string');
  assert.equal(args.envelope.signature, 'a'.repeat(128));
  assert.equal(args.envelope.model, 'z-ai/glm-5.3-flash');
  assert.equal(args.response, 'reply');
});
