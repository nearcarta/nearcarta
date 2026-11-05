import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askPlan, askReceivers, sharedAsk } from '../../src/vault.js';
// Hermetic: the model path is covered in agent.test.js with a fake model; never bill a live call here.
delete process.env.NEARAI_CLOUD_API_KEY;

const merchant = 'cafe.nearcarta.near';
const clauses = { pay: { asset: 'Native', receivers: [merchant, 'cafe-1.near'], per_action_cap: '20000000000000000000000' } };
const viewF = async (_a, m) => (m === 'get_clauses' ? clauses : { next_nonce: '7', policy_version: 3 });

test('askReceivers: charter allowlist first, then arena merchants, no duplicates', async () => {
  const r = await askReceivers('x.near', viewF);
  assert.equal(r[0], merchant); assert.ok(r.includes('cafe-1.near'));
  assert.equal(new Set(r).size, r.length);
});

test('askPlan: plain words -> the unsigned proposal, nonce and policy from chain state', async () => {
  const p = await askPlan('pay the cafe 0.01 NEAR for coffee', 'x.near', { viewF, nowMs: 0 });
  assert.equal(p.parsed.receiver, merchant); // the arena cafe (first allowlisted 'cafe' account)
  assert.equal(p.proposal.amount, '10000000000000000000000');
  assert.deepEqual([p.proposal.shop, p.proposal.clause_id, p.proposal.nonce, p.proposal.policy_version, p.proposal.memo], ['ask', 'pay', '7', 3, 'ask:mine:coffee']);
  assert.equal(p.on_allowlist, true);
});

test('askPlan: an off-allowlist payee is parsed as asked (the charter refuses it on chain)', async () => {
  const p = await askPlan('pay evil.near 5 NEAR', 'x.near', { viewF });
  assert.equal(p.parsed.receiver, 'evil.near'); assert.equal(p.on_allowlist, false);
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
