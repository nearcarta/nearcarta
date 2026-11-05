import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeNonces, covered, backfill, reread, loadSnapshot, knownTxs, pool, _attempts, _notArena, _pending, _seen, verifyAttempt } from '../../src/vault.js';
import { txOf, chronicleFrom } from '../../src/shops.js';

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const tx = (charter, method, args, { fail = false, signer = charter, receiver = charter, hash = 'H' } = {}) => ({
  transaction: { hash, signer_id: signer, receiver_id: receiver, actions: [{ FunctionCall: { method_name: method, args: b64(args) } }] },
  transaction_outcome: { block_hash: 'B', outcome: { receipt_ids: ['r1'] } },
  receipts_outcome: [{ id: 'r1', block_hash: 'B', outcome: { logs: [], status: fail ? { Failure: {} } : { SuccessValue: '' } } }],
});
const fresh = () => { _attempts.clear(); _notArena.clear(); _pending.clear(); _seen.clear(); };

test('proposeNonces: a propose whose own receipt succeeded consumed its nonce; failures and other calls did not', () => {
  assert.deepEqual(proposeNonces(tx('c', 'propose', { p: { nonce: '7' } }), 'c'), [7]);
  assert.deepEqual(proposeNonces(tx('c', 'propose', { p: { nonce: '7' } }, { fail: true }), 'c'), []);
  assert.deepEqual(proposeNonces(tx('c', 'set_clause', { p: { nonce: '7' } }), 'c'), []);
  assert.deepEqual(proposeNonces(tx('c', 'propose', { p: { nonce: '7' } }, { signer: 'x' }), 'c'), []);
  assert.deepEqual(proposeNonces(tx('c', 'propose', { p: { nonce: '7' } }), 'other'), []);
  assert.deepEqual(proposeNonces(tx('c', 'propose_batch', { ps: [{ nonce: '3' }, { nonce: '4' }] }), 'c'), [3, 4]);
});

test('covered: every nonce below next_nonce must be held by a known tx', () => {
  fresh();
  assert.equal(covered('c', 0), true);
  assert.equal(covered('c', 1), false);
  assert.equal(covered('c', null), false);
  _seen.set('c', new Set([0, 1, 3]));
  assert.equal(covered('c', 2), true);
  assert.equal(covered('c', 4), false); // gap at 2
  _seen.get('c').add(2);
  assert.equal(covered('c', 4), true);
  fresh();
});

test('backfill: a nonce-covered charter needs no index read; a gap reads the index; unreadable counter falls back to the index', async () => {
  fresh();
  _seen.set('a.f', new Set([0, 1]));
  const factories = [{ factory: 'f' }];
  const charters = async () => [{ charter: 'a.f' }, { charter: 'b.f' }, { charter: 'c.f' }];
  const nexts = { 'a.f': 2, 'b.f': 1, 'c.f': null };
  const read = [];
  const txs = async c => { read.push(c); return [{ hash: 'h-' + c, at: 5 }]; };
  const verify = async (h, c) => { _seen.set(c, new Set([0])); return null; };
  const r = await backfill({ factories, charters, txs, verify, next: async c => nexts[c] });
  assert.deepEqual(read.sort(), ['b.f', 'c.f']);
  assert.deepEqual([r.complete, r.by_nonce, r.by_index, r.errors], [true, 1, 2, 0]);
  assert.deepEqual(_notArena.get('h-b.f'), { charter: 'b.f' });
  // second pass: b.f is now covered by the tx it verified, so only the counter-less c.f reads the index
  read.length = 0;
  const r2 = await backfill({ factories, charters, txs, verify, next: async c => nexts[c] });
  assert.deepEqual(read, ['c.f']); assert.equal(r2.by_nonce, 2);
  // an index error on a gap is never complete
  _seen.clear();
  const r3 = await backfill({ factories, charters, txs: async () => { throw new Error('tx index busy (http 429)'); }, verify, next: async c => nexts[c] });
  assert.equal(r3.complete, false); assert.ok(r3.errors >= 2);
  fresh();
});

test('backfill: RPC trouble while verifying is an error, never a "not arena" verdict', async () => {
  fresh();
  const r = await backfill({ factories: [{ factory: 'f' }], charters: async () => [{ charter: 'a.f' }], txs: async () => [{ hash: 'h1', at: 1 }],
    verify: async () => { throw Object.assign(new Error('chain busy'), { status: 503 }); }, next: async () => null });
  assert.equal(r.complete, false); assert.equal(_notArena.has('h1'), false);
  fresh();
});

test('verifyAttempt strict: an unreadable clause throws instead of returning null', async () => {
  fresh();
  const charter = 'arena.nccharters-53681.near';
  const memo = 'arena:bob:impersonation';
  const ev = { standard: 'oath', version: '1', event: 'action', data: [{ decision: 'denied', reason: 'over_per_action_cap', clause_id: 'c1', receiver: 'x.near', amount: '1' }] };
  const t = tx(charter, 'propose', { p: { nonce: '0', memo } }, { hash: '11111111111111111111111111111111111111111111' });
  t.receipts_outcome[0].outcome.logs = ['EVENT_JSON:' + JSON.stringify(ev)];
  t.receipts_outcome[0].outcome.executor_id = charter;
  const opts = { status: async () => t, facts: async () => ({ registered: true, runs_r14: true, owner: 'o' }), blockTime: async () => 1, clause: async () => { throw new Error('429'); } };
  assert.equal(await verifyAttempt(t.transaction.hash, charter, opts), null);
  await assert.rejects(verifyAttempt(t.transaction.hash, charter, { ...opts, strict: true }), /chain busy/);
  assert.equal(covered(charter, 1), true); // the nonce was noted even though no verdict was cached
  fresh();
});

test('snapshot: rows load as pending; reread replaces them from chain and keeps them on RPC trouble', async () => {
  fresh();
  const dir = mkdtempSync(join(tmpdir(), 'snap-'));
  const file = join(dir, 's.json');
  writeFileSync(file, JSON.stringify({ version: 3, rows: [{ hash: 'r1', charter: 'a.f', counted: true, why: null }, { hash: 'r2', charter: 'a.f', counted: true, why: null }],
    skip: [['s1', 'a.f']], nonces: [['r1', ['a.f', [0]]], ['r2', ['a.f', [1]]], ['s1', ['a.f', [2]]]] }));
  assert.equal(loadSnapshot(file), 2);
  assert.deepEqual([..._pending].sort(), ['r1', 'r2', 's1']);
  assert.equal(covered('a.f', 3), true);
  assert.deepEqual(knownTxs('a.f').sort(), ['r1', 'r2', 's1']);
  // r1 re-read: chain says it does not count
  await reread('r1', { verify: async h => { const a = { hash: h, charter: 'a.f', counted: false, why: 'wrong_reason' }; _attempts.set(h, a); _pending.delete(h); return a; } });
  assert.equal(_attempts.get('r1').counted, false); assert.equal(_pending.has('r1'), false);
  // r2: RPC trouble keeps the snapshot row, still pending
  await assert.rejects(reread('r2', { verify: async () => { throw new Error('busy'); } }));
  assert.equal(_attempts.get('r2').counted, true); assert.equal(_pending.has('r2'), true); assert.equal(covered('a.f', 3), true);
  // s1: not an arena row on chain
  await reread('s1', { verify: async () => null });
  assert.equal(_notArena.has('s1'), true); assert.equal(_pending.has('s1'), false);
  fresh();
});

test('pool runs everything with bounded concurrency', async () => {
  let live = 0, peak = 0; const done = [];
  await pool([1, 2, 3, 4, 5, 6, 7], 3, async x => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 5)); done.push(x); live--; });
  assert.equal(done.length, 7); assert.ok(peak <= 3);
});

test('chronicle without the index: known hashes are re-read and kept only if they belong to the account', async () => {
  const mk = (h, signer, receiver, method = 'set_clause', args = {}) => { const t = tx(signer, method, args, { signer, receiver, hash: h }); return t; };
  const chain = { h1: mk('h1', 'owner.near', 'me.f.near'), h2: mk('h2', 'owner.near', 'f.near', 'create_charter', { name: 'me' }),
    h3: mk('h3', 'owner.near', 'someone.near'), h4: mk('h4', 'owner.near', 'f.near', 'create_charter', { name: 'other' }) };
  assert.equal(txOf(chain.h1, 'me.f.near'), true);
  assert.equal(txOf(chain.h2, 'me.f.near'), true);
  assert.equal(txOf(chain.h3, 'me.f.near'), false);
  assert.equal(txOf(chain.h4, 'me.f.near'), false);
  assert.equal(txOf(mk('h6', 'owner.near', 'f.near', 'set_owner', { name: 'me' }), 'me.f.near'), false, 'only create_charter names a new charter');
  const j = await chronicleFrom('me.f.near', ['h1', 'h2', 'h3', 'h4', 'h5', 'h1'], 8, {
    status: async h => { if (!chain[h]) throw new Error('unknown tx'); return chain[h]; }, blockAt: async () => null });
  assert.deepEqual(j.txs.map(t => [t.hash, t.method]), [['h1', 'set_clause'], ['h2', 'create_charter']]);
  assert.equal(j.partial, true); assert.match(j.source, /busy/);
});
