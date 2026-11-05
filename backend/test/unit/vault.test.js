import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { sha256 } from '@noble/hashes/sha2.js';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ATTACKS, lookalike, invoicePayee, pickClause, plan, proposal, MEMO_RE, matchesPlan, acceptedReasons } from '../../../shared/vault/attacks.js';
import { TASKS, TASK_IDS, TASK_MEMO_RE, planTask, matchesTask, taskAmount, taskProposal } from '../../../shared/vault/tasks.js';
import { keyFrom, signTx, functionCall, outcomeOf, PROPOSE_TGAS } from '../../../shared/vault/tx.js';
import { parseAsk, nearToYocto } from '../../../shared/vault/ask.js';
import { runAsk } from '../../../shared/vault/run.js';
import { runAttack, doTask, verifyAttempt, board, isAccount, _attempts, _notArena, Lru, saveBoard, loadBoard, runnerStatus } from '../../src/vault.js';

const M = 10n ** 21n; // milliNEAR
const clause = { asset: 'Native', receivers: ['cafe.pub.testnet', 'books.pub.testnet'], per_action_cap: String(50n * M),
  daily_budget: String(100n * M), min_amount: String(M), max_actions_per_day: 4 };

test('six attack patterns', () => {
  assert.deepEqual(ATTACKS.map(a => a.id), ['fake-invoice', 'injected-recipient', 'split-under-cap', 'impersonation', 'lookalike', 'slow-drain']);
});

test('look-alike and invoice payees are never the real payee', () => {
  assert.equal(lookalike('cafe.pub.testnet'), 'c4fe.pub.testnet');
  assert.equal(lookalike('zzz.pub.testnet'), 'zzzx.pub.testnet');
  assert.equal(invoicePayee('cafe.pub.testnet'), 'cafe-billing.pub.testnet');
  for (const r of clause.receivers) { assert.ok(!clause.receivers.includes(lookalike(r))); assert.ok(!clause.receivers.includes(invoicePayee(r))); }
});

test('plans aim at the right limit', () => {
  assert.equal(plan('impersonation', clause)[0].amount, String(400n * M));
  assert.equal(plan('injected-recipient', clause)[0].receiver, 'shop-moved-pay-here.near');
  // 100 budget / 50 cap -> 2 allowed + 1 refused
  assert.equal(plan('split-under-cap', clause).length, 3);
  assert.equal(plan('split-under-cap', clause, { spent: String(100n * M), count: 2 }).length, 1);
  // 4 actions/day -> 4 allowed + 1 refused; after 3 used -> 2 steps
  assert.equal(plan('slow-drain', clause).length, 5);
  assert.equal(plan('slow-drain', clause, { spent: String(3n * M), count: 3 }).length, 2);
  assert.throws(() => plan('slow-drain', { ...clause, max_actions_per_day: 0 }), /daily action count/);
  assert.throws(() => plan('slow-drain', { ...clause, max_actions_per_day: 20 }), /12 steps/);
  // 4 more 1-unit steps after 99 spent would pass the 100 budget: the budget would refuse first
  assert.throws(() => plan('slow-drain', clause, { spent: String(99n * M), count: 1 }), /budget refuses first/);
  assert.equal(plan('slow-drain', clause, { spent: String(95n * M), count: 0 }).length, 5);
  assert.throws(() => plan('nope', clause), /unknown attack/);
});

test('pickClause wants a Native allowlist', () => {
  assert.equal(pickClause({ a: { ...clause, per_action_cap: '9' }, b: clause }).id, 'a');
  assert.throws(() => pickClause({ x: { ...clause, asset: { Ft: 'usdc.testnet' } } }), /no Native clause/);
});

test('proposal memo is tagged and parsable', () => {
  const p = proposal({ clauseId: 'pay', step: { receiver: 'a.testnet', amount: '1' }, nonce: '7', policyVersion: 2, tag: 'neo', attackId: 'lookalike', nowMs: 0 });
  assert.equal(p.memo, 'arena:neo:lookalike'); assert.equal(p.nonce, '7'); assert.equal(p.expires_at, String(600_000n * 1_000_000n));
  assert.ok(MEMO_RE.test(p.memo)); assert.ok(p.memo.length <= 64);
  assert.throws(() => proposal({ clauseId: 'pay', step: {}, nonce: 0, policyVersion: 1, tag: 'Bad Tag', attackId: 'x' }), /tag/);
});

test('signed tx carries a valid ed25519 signature over sha256(tx)', () => {
  const key = keyFrom();
  const s = signTx({ key, signerId: 'c.testnet', receiverId: 'c.testnet', nonce: 5n, blockHash: bs58.encode(new Uint8Array(32)),
    actions: [functionCall('propose', { p: {} }, 100n * 10n ** 12n)] });
  const bytes = Buffer.from(s.base64, 'base64');
  const tx = bytes.subarray(0, bytes.length - 65);
  assert.equal(bs58.encode(sha256(tx)), s.hash);
  assert.equal(bytes[bytes.length - 65], 0);
  assert.ok(nacl.sign.detached.verify(sha256(tx), bytes.subarray(bytes.length - 64), bs58.decode(key.publicKey.slice(8))));
  assert.equal(keyFrom(key.secretKey).publicKey, key.publicKey);
});

test('outcomeOf reads success and failure', () => {
  assert.deepEqual(outcomeOf({ status: { SuccessValue: Buffer.from('{"decision":"denied"}').toString('base64') } }), { ok: true, value: { decision: 'denied' } });
  assert.equal(outcomeOf({ status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: 'ERR_NONCE' } } } } } }).error, 'ERR_NONCE');
});

test('runAttack stops at the first refusal and re-verifies it from chain', async () => {
  const sent = [];
  const viewF = async (_c, m) => m === 'get_clauses' ? { pay: clause } : m === 'get_usage' ? { spent: '0', reserved: '0', count: 0 } : { next_nonce: String(sent.length), policy_version: 2 };
  const send = async (_rpc, { p }) => { sent.push(p); return { hash: 'H' + sent.length, ok: true, value: { decision: sent.length < 3 ? 'allowed' : 'denied', reason: sent.length < 3 ? null : 'over_daily_budget' } }; };
  const checked = [];
  const verify = async (h, c) => { checked.push([h, c]); return null; };
  const r = await runAttack({ charter: 'arena.f.testnet', key: keyFrom(), attackId: 'split-under-cap', tag: 'neo', viewF, send, rpcCall: null, verify });
  assert.equal(r.steps.length, 3); assert.ok(r.refused); assert.equal(r.reason, 'over_daily_budget');
  assert.deepEqual(sent.map(p => p.nonce), ['0', '1', '2']);
  assert.deepEqual(checked, [['H3', 'arena.f.testnet']]);
  await assert.rejects(runAttack({ charter: 'a.testnet', key: null, attackId: 'nope', tag: 'x', viewF, send }), /unknown attack/);
  await assert.rejects(runAttack({ charter: 'a.testnet', key: null, attackId: 'lookalike', tag: 'X Y', viewF, send }), /nickname/);
});

const H = '4a633Ss2gs8n9XpEDJLacvbnn1TDddVBcs9KrdPSkcjp';
const facts = async c => ({ charter: c, registered: true, runs_r14: true, owner: 'alice.testnet' });
const at = async () => clause;
const hex = s => createHash('sha256').update(s).digest('hex');
function fakeTx({ method = 'propose', memo = 'arena:neo:lookalike', signer = 'c.f.testnet', failed = false, decision = 'denied',
  reason = 'receiver_not_allowlisted', receiver = 'c4fe.pub.testnet', amount = String(25n * M), memoHash, settle } = {}) {
  const args = Buffer.from(JSON.stringify({ p: { memo } })).toString('base64');
  const ev = (event, data) => 'EVENT_JSON:' + JSON.stringify({ standard: 'oath', version: '2.0.0', event, data: [data] });
  const logs = [ev('action', { action_id: decision === 'allowed' ? '7' : null, clause_id: 'pay', receiver, amount, memo_hash: memoHash ?? hex(memo), decision, reason: decision === 'allowed' ? null : reason })];
  const rs = [{ id: 'r', block_hash: 'RB', outcome: { executor_id: 'c.f.testnet', logs, status: failed ? { Failure: {} } : { SuccessValue: '' } } }];
  if (settle) rs.push({ id: 's', block_hash: 'SB', outcome: { executor_id: 'c.f.testnet', logs: [ev('settle', { action_id: '7', status: 'executed', reason: settle })], status: { SuccessValue: '' } } });
  return { transaction: { signer_id: signer, receiver_id: 'c.f.testnet', actions: [{ FunctionCall: { method_name: method, args } }] },
    transaction_outcome: { id: 't', block_hash: 'B', outcome: { executor_id: signer, logs: [], status: {} } }, receipts_outcome: rs };
}
const fresh = () => { _attempts.clear(); _notArena.clear(); };

test('verifyAttempt counts only refusals that match the attack plan and reason', async () => {
  fresh();
  let asked = null;
  const ok = await verifyAttempt(H, 'c.f.testnet', { status: async () => fakeTx(), facts, blockTime: async () => 1234, clause: async (c, id, b) => { asked = [c, id, b]; return clause; } });
  assert.deepEqual(asked, ['c.f.testnet', 'pay', 'RB'], 'clause read at the receipt block');
  assert.equal(ok.at, 1234); assert.equal(ok.kind, 'attack'); assert.equal(ok.counted, true, ok.why);
  assert.equal(ok.attack, 'lookalike'); assert.equal(ok.tag, 'neo'); assert.equal(ok.owner, 'alice.testnet'); assert.equal(ok.receiver, 'c4fe.pub.testnet');
  const notCounted = [
    [{ reason: 'over_per_action_cap' }, 'wrong_reason'],
    [{ receiver: 'someone.testnet' }, 'not_the_attack_plan'],
    [{ amount: String(24n * M) }, 'not_the_attack_plan'],
    [{ memo: 'arena:neo:impersonation' }, 'wrong_reason'],
    [{ decision: 'allowed', receiver: 'cafe.pub.testnet' }, 'not_refused'],
    [{ memoHash: 'ff' }, 'memo_mismatch'],
  ];
  for (const [c, why] of notCounted) { fresh(); const r = await verifyAttempt(H, 'c.f.testnet', { status: async () => fakeTx(c), facts, blockTime: async () => 1, clause: at }); assert.equal(r.counted, false, JSON.stringify(c)); assert.equal(r.why, why, JSON.stringify(c)); }
  fresh();
  assert.equal((await verifyAttempt(H, 'c.f.testnet', { status: async () => fakeTx(), facts, blockTime: async () => 1, clause: async () => null })).why, 'clause_unknown');
  const nulls = [{ method: 'set_clause' }, { memo: 'hello' }, { memo: 'arena:neo:unknown-attack' }, { signer: 'x.testnet' }, { failed: true }];
  for (const c of nulls) { fresh(); assert.equal(await verifyAttempt(H, 'c.f.testnet', { status: async () => fakeTx(c), facts, clause: at }), null, JSON.stringify(c)); }
  fresh();
  assert.equal(await verifyAttempt(H, 'c.f.testnet', { status: async () => fakeTx(), facts, clause: async () => { throw new Error('rpc down'); } }), null, 'rpc trouble is not cached as a verdict');
  assert.equal(_attempts.size, 0);
  assert.equal(await verifyAttempt(H, 'c.f.testnet', { status: async () => fakeTx(), facts: async () => ({ registered: true, runs_r14: false }) }), null);
  await assert.rejects(verifyAttempt('nothash', 'c.f.testnet', { status: async () => fakeTx(), facts }), /bad tx hash/);
});

test('verifyAttempt scores tasks: allowed, settled ok, the planned payee and amount', async () => {
  const t = c => fakeTx({ memo: 'task:neo:coffee-run', decision: 'allowed', receiver: 'cafe.pub.testnet', amount: String(12_500n * 10n ** 18n), settle: 'ok', ...c });
  fresh();
  const ok = await verifyAttempt(H, 'c.f.testnet', { status: async () => t(), facts, blockTime: async () => 1, clause: at });
  assert.equal(ok.kind, 'task'); assert.equal(ok.task, 'coffee-run'); assert.equal(ok.counted, true, ok.why);
  for (const [c, why] of [[{ decision: 'denied', reason: 'over_daily_budget' }, 'not_allowed'], [{ receiver: 'books.pub.testnet' }, 'not_the_task_plan'],
    [{ amount: String(50n * M) }, 'not_the_task_plan'], [{ settle: 'execution_failed_budget_released' }, 'payment_failed']]) {
    fresh(); const r = await verifyAttempt(H, 'c.f.testnet', { status: async () => t(c), facts, blockTime: async () => 1, clause: at }); assert.equal(r.why, why, JSON.stringify(c));
  }
});

test('attack plans match their own steps and nothing else', () => {
  for (const a of ATTACKS) {
    for (const st of plan(a.id, clause)) assert.ok(matchesPlan(a.id, st, clause), a.id);
    assert.ok(acceptedReasons(a.id).includes(a.expects));
  }
  assert.ok(!matchesPlan('lookalike', { receiver: 'cafe.pub.testnet', amount: String(25n * M) }, clause), 'allowlisted is never a look-alike');
  assert.ok(!matchesPlan('impersonation', { receiver: 'cafe.pub.testnet', amount: String(51n * M) }, clause));
  assert.ok(!matchesPlan('slow-drain', { receiver: 'cafe.pub.testnet', amount: String(50n * M) }, clause));
  assert.ok(!matchesPlan('nope', { receiver: 'x', amount: '1' }, clause));
  assert.ok(!matchesPlan('lookalike', { receiver: 'c4fe.pub.testnet', amount: 'x' }, clause));
  assert.deepEqual(acceptedReasons('slow-drain'), ['over_daily_action_count']);
});

test('tasks pay an allowlisted merchant a quarter of the cap, and stop when the day is used', () => {
  assert.deepEqual(TASKS.map(t => t.id), ['coffee-run', 'book-order']);
  assert.deepEqual(planTask('coffee-run', clause), { receiver: 'cafe.pub.testnet', amount: String(12_500n * 10n ** 18n) });
  assert.equal(planTask('book-order', clause).receiver, 'books.pub.testnet');
  assert.equal(taskAmount({ ...clause, per_action_cap: '8', min_amount: '5' }), 5n);
  assert.throws(() => planTask('coffee-run', clause, { spent: String(95n * M), count: 1 }), /budget/);
  assert.throws(() => planTask('coffee-run', clause, { spent: '0', count: 4 }), /count/);
  assert.throws(() => planTask('nope', clause), /unknown task/);
  for (const id of TASK_IDS) assert.ok(matchesTask(id, planTask(id, clause), clause));
  assert.ok(!matchesTask('coffee-run', planTask('book-order', clause), clause));
  const p = taskProposal({ clauseId: 'pay', step: planTask('coffee-run', clause), nonce: 3, policyVersion: 2, tag: 'neo', taskId: 'coffee-run', nowMs: 0 });
  assert.equal(p.memo, 'task:neo:coffee-run'); assert.ok(TASK_MEMO_RE.test(p.memo)); assert.equal(p.shop, 'tasks');
});

test('doTask signs one propose and re-verifies it', async () => {
  const sent = [];
  const viewF = async (_c, m) => m === 'get_clauses' ? { pay: clause } : m === 'get_usage' ? { spent: '0', reserved: '0', count: 0 } : { next_nonce: '9', policy_version: 2 };
  const send = async (_rpc, a) => { sent.push(a); return { hash: 'T1', ok: true, value: { decision: 'allowed', reason: null } }; };
  const r = await doTask({ charter: 'arena.f.testnet', key: keyFrom(), taskId: 'book-order', tag: 'neo', viewF, send, rpcCall: null, verify: async () => ({ counted: true, why: null }) });
  assert.equal(r.passed, true); assert.equal(r.counted, true); assert.equal(sent.length, 1); assert.equal(sent[0].p.receiver, 'books.pub.testnet');
  assert.equal(sent[0].gasTgas, undefined, 'default gas from sendPropose'); assert.equal(PROPOSE_TGAS, 30);
});

test('a stale nonce view never reuses a landed nonce', async () => {
  let chain = 20; const sent = [];
  // The view is stuck at 20 (cache or lagging node) while the chain moves on.
  const viewF = async (_c, m) => m === 'get_clauses' ? { pay: clause } : m === 'get_usage' ? { spent: '0', reserved: '0', count: 0 } : { next_nonce: '20', policy_version: 2 };
  const send = async (_rpc, a) => { sent.push(Number(a.p.nonce));
    if (Number(a.p.nonce) !== chain) return { hash: 'X' + sent.length, ok: false, error: 'Smart contract panicked: ERR_NONCE' };
    chain++; return { hash: 'T' + sent.length, ok: true, value: { decision: 'allowed', reason: 'ok' } }; };
  const opts = { charter: 'nonce.f.testnet', key: keyFrom(), tag: 'neo', viewF, send, rpcCall: null, verify: async () => ({ counted: true, why: null }) };
  assert.equal((await doTask({ ...opts, taskId: 'coffee-run' })).passed, true);
  assert.equal((await doTask({ ...opts, taskId: 'book-order' })).passed, true);
  assert.deepEqual(sent, [20, 21]);
});

test('verifyAttempt scores an honest ask: allowed, settled ok, allowlisted, within the cap', async () => {
  const k = c => fakeTx({ memo: 'ask:neo:team-coffee', decision: 'allowed', receiver: 'cafe.pub.testnet', amount: String(10n * M), settle: 'ok', ...c });
  fresh();
  const ok = await verifyAttempt(H, 'c.f.testnet', { status: async () => k(), facts, blockTime: async () => 1, clause: at });
  assert.equal(ok.kind, 'ask'); assert.equal(ok.ask, 'team-coffee'); assert.equal(ok.tag, 'neo'); assert.equal(ok.counted, true, ok.why);
  fresh(); const scam = await verifyAttempt(H, 'c.f.testnet', { status: async () => k({ decision: 'denied', reason: 'receiver_not_allowlisted', receiver: 'c4fe.pub.testnet' }), facts, blockTime: async () => 1, clause: at });
  assert.equal(scam.counted, true, 'a free-text request the charter refused counts as a blocked scam'); assert.equal(scam.why, null);
  for (const [c, why] of [[{ receiver: 'someone.testnet' }, 'not_on_allowlist_or_over_cap'], [{ amount: String(51n * M) }, 'not_on_allowlist_or_over_cap'],
    [{ settle: 'transfer_failed' }, 'payment_failed'], [{ memoHash: 'ff' }, 'memo_mismatch']]) {
    fresh(); const r = await verifyAttempt(H, 'c.f.testnet', { status: async () => k(c), facts, blockTime: async () => 1, clause: at });
    assert.equal(r.counted, false, JSON.stringify(c)); assert.equal(r.why, why, JSON.stringify(c));
  }
  fresh(); assert.equal(await verifyAttempt(H, 'c.f.testnet', { status: async () => k({ memo: 'ask:team-coffee' }), facts, clause: at }), null, 'old untagged ask memos are not scored');
  fresh();
});

test('board counts one honest ask per player as an honest payment', () => {
  const ask = (h, at) => ({ hash: h, charter: 'x', owner: 'o1', kind: 'ask', ask: 'coffee', tag: 'mine', decision: 'allowed', counted: true, shared: false, at });
  const [p] = board([ask('a', 1), ask('b', 2), { ...ask('c', 3), counted: false, why: 'not_allowed', decision: 'denied' }]);
  assert.equal(p.score, 1); assert.deepEqual(p.tasks, ['honest-ask']); assert.equal(p.tasks_passed, 2); assert.equal(p.not_counted, 1); assert.equal(p.max_score, 10);
});

test('board counts a refused free-text ask once as the own-scam pattern', () => {
  const ask = (h, decision, at) => ({ hash: h, charter: 'x', owner: 'o1', kind: 'ask', ask: 'scam', tag: 'mine', decision, reason: decision === 'denied' ? 'receiver_not_allowlisted' : 'ok', counted: true, shared: false, at });
  const [p] = board([ask('a', 'denied', 1), ask('b', 'denied', 2), ask('c', 'allowed', 3)]);
  assert.deepEqual(p.patterns, ['own-scam']); assert.deepEqual(p.tasks, ['honest-ask']); assert.equal(p.refusals, 2); assert.equal(p.score, 2);
});

test('board scores tasks passed plus scams blocked, counting only verified rows', () => {
  const rows = board([
    { hash: 'a', charter: 'x', owner: 'o1', kind: 'attack', attack: 'lookalike', tag: 't', decision: 'denied', counted: true, shared: false, at: 1 },
    { hash: 'b', charter: 'x', owner: 'o1', kind: 'task', task: 'coffee-run', tag: 't', decision: 'allowed', counted: true, shared: false, at: 2 },
    { hash: 'c', charter: 's', owner: 'arena', kind: 'attack', attack: 'lookalike', tag: 'neo', decision: 'denied', counted: true, shared: true, server_signed: true, at: 3 },
    { hash: 'd', charter: 's', owner: 'arena', kind: 'attack', attack: 'impersonation', tag: 'neo', decision: 'denied', counted: false, why: 'wrong_reason', shared: true, server_signed: true, at: 4 },
    { hash: 'e', charter: 's', owner: 'arena', kind: 'attack', attack: 'slow-drain', tag: 'neo', decision: 'allowed', counted: false, shared: true, server_signed: true, at: 5 },
  ]);
  assert.equal(rows[0].player, 'o1'); assert.equal(rows[0].score, 2); assert.equal(rows[0].max_score, 10); assert.equal(rows[0].verified, true);
  assert.equal(rows[1].player, 'neo'); assert.equal(rows[1].score, 1); assert.equal(rows[1].server_signed, true); assert.equal(rows[1].refusals, 1); assert.equal(rows[1].not_counted, 1);
});

test('LRU refreshes on read and evicts the oldest', () => {
  const l = new Lru(2); l.set('a', 1).set('b', 2); l.get('a'); l.set('c', 3);
  assert.deepEqual([...l.entries()].map(e => e[0]), ['a', 'c']); assert.equal(l.size, 2);
});

test('board persists to disk and loads back', () => {
  fresh();
  const file = join(mkdtempSync(join(tmpdir(), 'vb-')), 'board.json');
  _attempts.set('h1', { hash: 'h1', charter: 'x', counted: true }); _notArena.set('h2', 1);
  assert.ok(saveBoard(file)); fresh();
  assert.equal(loadBoard(file), 1); assert.ok(_notArena.has('h2')); fresh();
});

test('runner status reports the 30 Tgas gas and daily cap', async () => {
  const s = await runnerStatus();
  if (s.enabled === false && !s.daily_tx_cap) return; // vault not on this network
  assert.equal(s.gas_tgas, 30); assert.ok(s.daily_tx_cap >= 0); assert.ok(s.resets_at.endsWith('Z'));
});

test('account ids', () => {
  assert.ok(isAccount('arena.nccharters-17102.testnet')); assert.ok(!isAccount('Bad..id')); assert.ok(!isAccount('a'));
});

test('parseAsk reads plain requests and names the payee', () => {
  const R = ['cafe.pub.testnet', 'books.pub.testnet'];
  assert.deepEqual(parseAsk('Pay the cafe 0.01 NEAR for team coffee', R), { receiver: 'cafe.pub.testnet', amount: String(10n * M), note: 'team coffee', memo: 'ask:mine:team-coffee' });
  assert.equal(parseAsk('pay the cafe 0.01 NEAR', R, 'neo').memo, 'ask:neo:payment');
  assert.throws(() => parseAsk('pay the cafe 0.01 NEAR', R, 'Bad Nick'), /nickname/);
  assert.equal(parseAsk('send 0.02 to the bookshop', R).receiver, 'books.pub.testnet');
  assert.equal(parseAsk('pay book 0.005 near', R).amount, String(5n * M));
  // An account off the allowlist is parsed as asked: the charter, not the parser, refuses it.
  assert.equal(parseAsk('pay refund-desk.testnet 0.01 NEAR', R).receiver, 'refund-desk.testnet');
  assert.equal(parseAsk('pay c4fe.pub.testnet 1', R).amount, String(1000n * M));
  assert.throws(() => parseAsk('pay the cafe', R), /how much/);
  assert.throws(() => parseAsk('pay 0.01 NEAR', R), /Name the payee/);
  assert.equal(nearToYocto('.5'), String(500n * M));
});

test('runAsk sends one propose with the parsed payee and an ask memo', async () => {
  const sent = [];
  const viewF = async (_c, m) => m === 'get_clauses' ? { pay: clause } : { next_nonce: '3', policy_version: 2 };
  const send = async (_rpc, a) => { sent.push(a.p); return { hash: 'A1', ok: true, value: { decision: 'denied', reason: 'receiver_not_allowlisted' } }; };
  const r = await runAsk({ charter: 'ask.f.testnet', key: keyFrom(), receiver: 'refund-desk.testnet', amount: String(M), memo: 'ask:refund', viewF, send, rpcCall: null });
  assert.equal(r.passed, false); assert.equal(r.reason, 'receiver_not_allowlisted');
  assert.equal(sent[0].shop, 'ask'); assert.equal(sent[0].memo, 'ask:refund'); assert.equal(sent[0].nonce, '3'); assert.equal(sent[0].clause_id, 'pay');
});

test('rpcClient falls through to the next RPC on 429 and never retries a JSON-RPC error', async () => {
  const { rpcClient } = await import('../../../shared/vault/tx.js');
  const hits = [];
  const fake = (answers) => async (url) => { hits.push(url); const a = answers[url].shift(); return { ok: a.status === 200, status: a.status, json: async () => a.body }; };
  let c = rpcClient(['https://a', 'https://b'], fake({ 'https://a': [{ status: 429 }], 'https://b': [{ status: 200, body: { result: 7 } }] }), { sleep: async () => {} });
  assert.equal(await c('block', {}), 7);
  assert.deepEqual(hits, ['https://a', 'https://b']);
  hits.length = 0;
  c = rpcClient(['https://a', 'https://b'], fake({ 'https://a': [{ status: 200, body: { error: { name: 'HANDLER_ERROR', cause: { name: 'INVALID_TRANSACTION' } } } }], 'https://b': [] }), { sleep: async () => {} });
  await assert.rejects(c('send_tx', {}), /INVALID_TRANSACTION/);
  assert.deepEqual(hits, ['https://a']);
  c = rpcClient('https://a', fake({ 'https://a': [{ status: 503 }, { status: 503 }] }), { rounds: 2, sleep: async () => {} });
  await assert.rejects(c('block', {}), /http 503/);
  // An unreachable host (fetch throws, as with CORS or DNS in a browser) falls through too.
  hits.length = 0;
  c = rpcClient(['https://a', 'https://b'], async url => { hits.push(url); if (url === 'https://a') throw new TypeError('Failed to fetch'); return { ok: true, status: 200, json: async () => ({ result: 9 }) }; }, { sleep: async () => {} });
  assert.equal(await c('block', {}), 9); assert.deepEqual(hits, ['https://a', 'https://b']);
  c = rpcClient(['https://a'], async () => { throw new TypeError('Failed to fetch'); }, { rounds: 2, sleep: async () => {} });
  await assert.rejects(c('block', {}), /network error at https:\/\/a/);
});

test('vault config gives the browser the same RPC fallbacks as the runner', async () => {
  const { config } = await import('../../src/vault.js');
  let c; try { c = config(); } catch { return; } // vault not on this network
  assert.ok(Array.isArray(c.rpc_fallbacks) && c.rpc_fallbacks.length > 0); assert.ok(!c.rpc_fallbacks.includes(c.rpc));
});

test('isFactoryCharter: only ids under a vault factory that its registry lists', async () => {
  const { isFactoryCharter, V: VV } = await import('../../src/vault.js');
  if (!VV) return;
  let calls = 0;
  const v = async (_f, _m, a) => { calls++; return a.account_id.startsWith('real.') ? { owner: 'o.testnet' } : null; };
  assert.equal(await isFactoryCharter('x.someone-else.testnet', v), false);
  assert.equal(await isFactoryCharter('Bad..id', v), false);
  assert.equal(calls, 0, 'no RPC for ids outside the factories');
  assert.equal(await isFactoryCharter('real.' + VV.factory, v), true);
  assert.equal(await isFactoryCharter('fake.' + VV.factory, v), false);
  assert.equal(await isFactoryCharter('fake.' + VV.factory, v), false);
  assert.equal(calls, 2, 'registry answers are cached');
});

// ---------- board survives a restart: rebuilt from chain, honest about gaps ----------
import { backfill, charterTxs, boot, rebuild } from '../../src/vault.js';

test('charterTxs retries index 429s, pages to the end, keeps only self-called function txs', async () => {
  let n = 0;
  const pages = [
    { account_txs: [{ transaction_hash: 'a', is_signer: true, is_receiver: true, is_function_call: true, tx_block_timestamp: '2000000000' },
      { transaction_hash: 'x', is_signer: true, is_receiver: false, is_function_call: true, tx_block_timestamp: '1' }], resume_token: 'r1' },
    { account_txs: [{ transaction_hash: 'b', is_signer: true, is_receiver: true, is_function_call: true, tx_block_timestamp: '3000000000' }] },
  ];
  const f = async (_u, o) => { n++; if (n === 1) return { ok: false, status: 429 }; const b = JSON.parse(o.body); return { ok: true, json: async () => pages[b.resume_token ? 1 : 0] }; };
  assert.deepEqual(await charterTxs('c.testnet', { f, waitMs: 1 }), [{ hash: 'a', at: 2000 }, { hash: 'b', at: 3000 }]);
  assert.equal(n, 3);
  await assert.rejects(charterTxs('c.testnet', { f: async () => ({ ok: false, status: 429 }), waitMs: 1 }), /429/);
  await assert.rejects(charterTxs('c.testnet', { f: async () => ({ ok: false, status: 400 }), waitMs: 1 }), /400/);
});

test('backfill rebuilds an empty board from chain and is incomplete while the index fails', async () => {
  fresh();
  const factories = [{ factory: 'f.testnet' }];
  const charters = async () => [{ charter: 'own.f.testnet' }, { charter: 'arena.f.testnet' }];
  const rows = { 'own.f.testnet': [{ hash: 'h1', at: 1 }, { hash: 'h2', at: 2 }], 'arena.f.testnet': [{ hash: 'h3', at: 3 }] };
  let down = true;
  const txs = async c => { if (down && c === 'arena.f.testnet') throw new Error('tx index http 429'); return rows[c]; };
  const verify = async (h, c) => h === 'h2' ? null : (_attempts.set(h, { hash: h, charter: c, counted: true, at: null }), _attempts.get(h));
  const next = async () => null; // no nonce counter readable: the index decides
  let r = await backfill({ factories, charters, txs, verify, next });
  assert.deepEqual([r.complete, r.errors, _attempts.size], [false, 1, 1]);
  down = false;
  r = await backfill({ factories, charters, txs, verify, next });
  assert.deepEqual([r.complete, r.errors, _attempts.size], [true, 0, 2]);
  assert.ok(_notArena.has('h2'));
  assert.equal(_attempts.get('h3').at, 3);
  // budget: stops early and says so
  fresh();
  r = await backfill({ factories, charters, txs, verify, next, budget: 1 });
  assert.equal(r.complete, false);
  // a charter list failure is never "complete"
  r = await backfill({ factories, charters: async () => { throw new Error('rpc 429'); }, txs, verify, next });
  assert.equal(r.complete, false);
  fresh();
});

test('boot keeps filling after index errors until a pass completes', async () => {
  let calls = 0;
  const fill = async () => (++calls < 3 ? { complete: false, errors: 1 } : { complete: true, errors: 0 });
  const t0 = Date.now();
  boot({ fill, firstMs: 0, snapshotFile: null });
  while (!rebuild.complete_at && Date.now() - t0 < 10_000) await new Promise(r => setTimeout(r, 50));
  assert.equal(calls, 3);
  assert.ok(rebuild.complete_at >= rebuild.started_at);
});

test('refreshBoard answers within its wait and keeps the last fill result', async () => {
  const { refreshBoard } = await import('../../src/vault.js');
  assert.deepEqual(await refreshBoard(50, async () => ({ complete: true })), { complete: true });
  let finished = false;
  const r = await refreshBoard(20, () => new Promise(res => setTimeout(() => { finished = true; res({ complete: false }); }, 2000)));
  assert.equal(finished, false); // the wait returns the last result; the fill is still running
  assert.deepEqual(r, { complete: true });
  assert.deepEqual(await refreshBoard(20, async () => { throw new Error('429'); }), { complete: true });
  for (let i = 0; i < 80 && !finished; i++) await new Promise(res => setTimeout(res, 50));
  assert.equal(finished, true);
  assert.deepEqual(await refreshBoard(20, async () => { throw new Error('429'); }), { complete: false }); // the slow fill landed
});

test('a restart with no disk and no snapshot rebuilds the same board from chain at boot', async () => {
  fresh();
  const factories = [{ factory: 'f.testnet' }];
  const charters = async () => [{ charter: 'arena.f.testnet' }, { charter: 'own.f.testnet' }];
  const chain = { 'arena.f.testnet': [{ hash: 'r1', at: 10 }, { hash: 'r2', at: 20 }], 'own.f.testnet': [{ hash: 'r3', at: 30 }, { hash: 'r4', at: 40 }] };
  const facts = { r1: { kind: 'attack', attack: 'fake-invoice', decision: 'denied', counted: true, shared: true, tag: 'ana' },
    r2: { kind: 'task', task: 't1', decision: 'allowed', counted: true, shared: true, tag: 'ana' },
    r3: { kind: 'attack', attack: 'lookalike', decision: 'denied', counted: true, owner: 'bo.testnet' }, r4: null };
  const verify = async (h, c) => { if (!facts[h]) return null; const a = { hash: h, charter: c, ...facts[h], at: null }; _attempts.set(h, a); return a; };
  const fill = o => backfill({ ...o, factories, charters, txs: async c => chain[c], verify, next: async () => null });
  assert.equal((await fill({})).complete, true);
  const before = JSON.stringify(board());
  // restart: memory gone, /tmp board gone (no paid disk), no committed snapshot
  fresh();
  const gone = join(mkdtempSync(join(tmpdir(), 'nc-')), 'none.json');
  rebuild.complete_at = null;
  boot({ fill, firstMs: 0, snapshotFile: null, boardFile: gone });
  assert.equal(rebuild.board_file_rows, 0);
  const t0 = Date.now();
  while (!rebuild.complete_at && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 20));
  assert.ok(rebuild.complete_at, 'boot rebuild completed');
  assert.equal(_attempts.size, 3);
  assert.equal(JSON.stringify(board()), before, 'same players, scores and order as before the restart');
  fresh();
});
