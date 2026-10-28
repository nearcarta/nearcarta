import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { sha256 } from '@noble/hashes/sha2.js';
import { ATTACKS, lookalike, invoicePayee, pickClause, plan, proposal, MEMO_RE } from '../../../shared/vault/attacks.js';
import { keyFrom, signTx, functionCall, outcomeOf } from '../../../shared/vault/tx.js';
import { runAttack, verifyAttempt, board, isAccount, _attempts } from '../../src/vault.js';

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
  assert.equal(plan('injected-recipient', clause)[0].receiver, 'refund-desk.testnet');
  // 100 budget / 50 cap -> 2 allowed + 1 refused
  assert.equal(plan('split-under-cap', clause).length, 3);
  assert.equal(plan('split-under-cap', clause, { spent: String(100n * M), count: 2 }).length, 1);
  // 4 actions/day -> 4 allowed + 1 refused; after 3 used -> 2 steps
  assert.equal(plan('slow-drain', clause).length, 5);
  assert.equal(plan('slow-drain', clause, { spent: String(3n * M), count: 3 }).length, 2);
  assert.throws(() => plan('slow-drain', { ...clause, max_actions_per_day: 0 }), /12 steps/);
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

test('runAttack stops at the first refusal and remembers it', async () => {
  const sent = [];
  const viewF = async (_c, m) => m === 'get_clauses' ? { pay: clause } : m === 'get_usage' ? { spent: '0', reserved: '0', count: 0 } : { next_nonce: String(sent.length), policy_version: 2 };
  const send = async (_rpc, { p }) => { sent.push(p); return { hash: 'H' + sent.length, ok: true, value: { decision: sent.length < 3 ? 'allowed' : 'denied', reason: sent.length < 3 ? null : 'over_daily_budget' } }; };
  const r = await runAttack({ charter: 'arena.f.testnet', key: keyFrom(), attackId: 'split-under-cap', tag: 'neo', viewF, send, rpcCall: null });
  assert.equal(r.steps.length, 3); assert.ok(r.refused); assert.equal(r.reason, 'over_daily_budget');
  assert.deepEqual(sent.map(p => p.nonce), ['0', '1', '2']);
  assert.ok(_attempts.has('H3'));
  await assert.rejects(runAttack({ charter: 'a.testnet', key: null, attackId: 'nope', tag: 'x', viewF, send }), /unknown attack/);
  await assert.rejects(runAttack({ charter: 'a.testnet', key: null, attackId: 'lookalike', tag: 'X Y', viewF, send }), /nickname/);
});

const H = '4a633Ss2gs8n9XpEDJLacvbnn1TDddVBcs9KrdPSkcjp';
const facts = async c => ({ charter: c, registered: true, runs_r14: true, owner: 'alice.testnet' });
function fakeTx({ method = 'propose', memo = 'arena:neo:lookalike', signer = 'c.f.testnet', failed = false, decision = 'denied' } = {}) {
  const args = Buffer.from(JSON.stringify({ p: { memo } })).toString('base64');
  const log = 'EVENT_JSON:' + JSON.stringify({ standard: 'oath', version: '2.0.0', event: 'action', data: [{ decision, reason: 'receiver_not_allowlisted' }] });
  return { transaction: { signer_id: signer, receiver_id: 'c.f.testnet', actions: [{ FunctionCall: { method_name: method, args } }] },
    transaction_outcome: { id: 't', outcome: { executor_id: signer, logs: [], status: {} } },
    receipts_outcome: [{ id: 'r', outcome: { executor_id: 'c.f.testnet', logs: [log], status: failed ? { Failure: {} } : { SuccessValue: '' } } }] };
}

test('verifyAttempt accepts only real arena refusals on factory charters', async () => {
  _attempts.clear();
  const ok = await verifyAttempt(H, 'c.f.testnet', { status: async () => fakeTx(), facts });
  assert.equal(ok.attack, 'lookalike'); assert.equal(ok.tag, 'neo'); assert.equal(ok.decision, 'denied'); assert.equal(ok.owner, 'alice.testnet');
  const cases = [{ method: 'set_clause' }, { memo: 'hello' }, { memo: 'arena:neo:unknown-attack' }, { signer: 'x.testnet' }, { failed: true }];
  for (const c of cases) { _attempts.clear(); assert.equal(await verifyAttempt(H, 'c.f.testnet', { status: async () => fakeTx(c), facts }), null, JSON.stringify(c)); }
  _attempts.clear();
  assert.equal(await verifyAttempt(H, 'c.f.testnet', { status: async () => fakeTx(), facts: async () => ({ registered: true, runs_r14: false }) }), null);
  await assert.rejects(verifyAttempt('nothash', 'c.f.testnet', { status: async () => fakeTx(), facts }), /bad tx hash/);
});

test('board ranks by patterns, then refusals; shared rows are nicknames', () => {
  const rows = board([
    { hash: 'a', charter: 'x', owner: 'o1', attack: 'lookalike', tag: 't', decision: 'denied', shared: false, at: 1 },
    { hash: 'b', charter: 'x', owner: 'o1', attack: 'lookalike', tag: 't', decision: 'denied', shared: false, at: 2 },
    { hash: 'c', charter: 's', owner: 'arena', attack: 'lookalike', tag: 'neo', decision: 'denied', shared: true, at: 3 },
    { hash: 'd', charter: 's', owner: 'arena', attack: 'impersonation', tag: 'neo', decision: 'denied', shared: true, at: 4 },
    { hash: 'e', charter: 's', owner: 'arena', attack: 'slow-drain', tag: 'neo', decision: 'allowed', shared: true, at: 5 },
  ]);
  assert.equal(rows[0].player, 'neo'); assert.equal(rows[0].verified, false); assert.equal(rows[0].pattern_count, 2); assert.equal(rows[0].attempts, 3);
  assert.equal(rows[1].player, 'o1'); assert.equal(rows[1].verified, true); assert.equal(rows[1].refusals, 2);
});

test('account ids', () => {
  assert.ok(isAccount('arena.nccharters-17102.testnet')); assert.ok(!isAccount('Bad..id')); assert.ok(!isAccount('a'));
});
