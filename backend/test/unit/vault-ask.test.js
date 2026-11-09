import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askPlan, askReceivers, sharedAsk } from '../../src/vault.js';
// Hermetic: the model path is covered in agent.test.js with a fake model; never bill a live call here.
delete process.env.NEARAI_CLOUD_API_KEY;

const merchant = 'cafe.nearcarta.near';
const BOARD = 'board.nearcarta.near';
const clauses = { pay: { asset: 'Native', receivers: [merchant, 'cafe-1.near'], per_action_cap: '20000000000000000000000' } };
// A legacy oath at x.near: answers get_clauses/get_state; the board has no row for x.near.
const viewF = async (acct, m) => {
  if (acct === BOARD) return null;
  return m === 'get_clauses' ? clauses : { next_nonce: '7', policy_version: 3 };
};
// The live board: rows are read ON THE BOARD with get_charter({ owner }); a visitor account has no contract.
const ROW = { owner: 'visitor.near', receivers: ['townhall.nearcarta.near'], per_action_cap: '10000000000000000000000',
  daily_budget: '50000000000000000000000', min_amount: '100000000000000000000', max_actions_per_day: 8, nonce: '4',
  balance: '10000000000000000000000', spent_today: '0', actions_today: 0, frozen: false, expires_at: '0' };
const calls = [];
const boardView = async (acct, m, args) => {
  calls.push([acct, m, args?.owner]);
  if (acct === BOARD && m === 'get_charter') return args?.owner === 'visitor.near' ? ROW : null;
  throw new Error(`view ${m}: wasm execution failed with error: MethodResolveError(MethodNotFound)`);
};

test('askReceivers: legacy oath clauses only, no duplicates, no arena merchants mixed in', async () => {
  const r = await askReceivers('x.near', viewF);
  assert.deepEqual(r, [merchant, 'cafe-1.near']);
});

test('askPlan: legacy oath -> the unsigned proposal, nonce and policy from chain state', async () => {
  const p = await askPlan('pay the cafe 0.01 NEAR for coffee', 'x.near', { viewF, nowMs: 0 });
  assert.equal(p.parsed.receiver, merchant);
  assert.equal(p.proposal.amount, '10000000000000000000000');
  assert.deepEqual([p.proposal.shop, p.proposal.clause_id, p.proposal.nonce, p.proposal.policy_version, p.proposal.memo], ['ask', 'pay', '7', 3, 'ask:mine:coffee']);
  assert.equal(p.on_allowlist, true);
  assert.equal(p.allowlist_source, 'oath');
});

test('askPlan: an off-allowlist payee is parsed as asked (the charter refuses it on chain)', async () => {
  const p = await askPlan('pay evil.near 5 NEAR', 'x.near', { viewF });
  assert.equal(p.parsed.receiver, 'evil.near'); assert.equal(p.on_allowlist, false);
});

test('askPlan: a visitor id reads its row on the BOARD with owner = the visitor', async () => {
  calls.length = 0;
  const p = await askPlan('pay townhall.nearcarta.near 0.001 NEAR', 'visitor.near', { viewF: boardView, nowMs: 0 });
  assert.deepEqual(calls[0], [BOARD, 'get_charter', 'visitor.near'], 'get_charter is asked of the board, not the visitor account');
  assert.equal(p.allowlist_source, 'board');
  assert.deepEqual(p.allowlist, ['townhall.nearcarta.near']);
  assert.equal(p.on_allowlist, true);
  assert.equal(p.charter, BOARD); assert.equal(p.owner, 'visitor.near');
  assert.equal(p.proposal.nonce, '4', 'the row field is `nonce`');
  assert.equal(p.per_action_cap, ROW.per_action_cap); assert.equal(p.min_amount, ROW.min_amount);
  assert.equal(p.clause_id, null);
});

test('askPlan: the board named with an owner reads the same row', async () => {
  const p = await askPlan('pay townhall.nearcarta.near 0.001 NEAR', BOARD, { viewF: boardView, owner: 'visitor.near', nowMs: 0 });
  assert.equal(p.owner, 'visitor.near'); assert.deepEqual(p.allowlist, ['townhall.nearcarta.near']);
  await assert.rejects(askPlan('pay townhall.nearcarta.near 0.001 NEAR', BOARD, { viewF: boardView }), e => e.status === 400);
});

test('askPlan: an account with no row and no charter is a plain 404, never the arena merchants', async () => {
  await assert.rejects(askPlan('pay the cafe 0.01 NEAR', 'stranger.near', { viewF: boardView }), e => e.status === 404 && /no board row/.test(e.message));
  await assert.rejects(askReceivers('stranger.near', boardView), e => e.status === 404);
});

test('askPlan: bad input is a 400 with a plain message', async () => {
  await assert.rejects(askPlan('', 'x.near', { viewF }), e => e.status === 400);
  await assert.rejects(askPlan('pay the cafe', 'x.near', { viewF }), e => e.status === 400 && /how much/.test(e.message));
  await assert.rejects(askPlan('pay 1 NEAR', 'Not An Account', { viewF }), e => e.status === 400);
  await assert.rejects(askPlan('pay 0.01 NEAR', null, { viewF }), e => e.status === 503);
});

test('sharedAsk: 503 when no agent key is set; never signs', async () => {
  const saved = process.env.ARENA_AGENT_KEY; delete process.env.ARENA_AGENT_KEY;
  let ran = false;
  await assert.rejects(sharedAsk('pay 0.01 NEAR', { run: async () => { ran = true; } }), e => e.status === 503);
  assert.equal(ran, false);
  if (saved !== undefined) process.env.ARENA_AGENT_KEY = saved;
});

test('sharedAsk: ARENA_AGENT_KEY is ignored on mainnet; never signs', async () => {
  const saved = process.env.ARENA_AGENT_KEY;
  process.env.ARENA_AGENT_KEY = 'ed25519:' + 'A'.repeat(80);
  let ran = false;
  await assert.rejects(sharedAsk('pay 0.01 NEAR', { run: async () => { ran = true; } }), e => e.status === 503);
  assert.equal(ran, false);
  if (saved !== undefined) process.env.ARENA_AGENT_KEY = saved; else delete process.env.ARENA_AGENT_KEY;
});
