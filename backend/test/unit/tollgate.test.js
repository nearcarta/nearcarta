import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as tg from '../../src/tollgate.js';
import { DEP } from '../../src/config.js';

test('toll gate is in the deployments file with 0 keys and the v5 artifact hash', () => {
  assert.equal(DEP.toll_gate.access_keys, 0);
  assert.equal(DEP.toll_gate.wasm_sha256, createHash('sha256').update(readFileSync(new URL('../../../' + DEP.toll_gate.wasm, import.meta.url))).digest('hex'));
  assert.equal(DEP.toll_gate.wasm_sha256, 'ae57ff8dfcc47e0553c0b83a665438a5b81da2ec0d080ca9e430e76b81901e28');
  assert.equal(DEP.toll_gate.policy.memo, 'toll:base-sepolia');
});
test('the toll gate accepts the current factory and every older one', () => {
  const v = DEP.vault, list = DEP.toll_gate.policy.factories;
  for (const f of [v.factory, ...(v.legacy || []).map(l => l.factory || l)]) assert.ok(list.includes(f), f);
});
test('a bad nonce is refused before any read', async () => {
  for (const n of ['x', '-1', '1.5']) {
    await assert.rejects(tg.visit(n), e => e.status === 400);
    await assert.rejects(tg.broadcast(n), e => e.status === 400);
  }
});

const POL = { next_nonce: 3, budget: '30000000000000', spent: '800000000000', gate: { evm_value: '100000000000', max_fee_per_gas: '100000000', max_priority_fee_per_gas: '1000000' } };
test('gas info counts visits left at the fee cap and warns when low', () => {
  const ok = tg.gasInfo(POL, 515190000000000n, 6000000n);
  assert.equal(ok.per_visit_at_cap_wei, '2200000000000');
  assert.equal(ok.visits_left_at_cap, 234);
  assert.ok(ok.visits_left_now > ok.visits_left_at_cap);
  assert.equal(ok.budget_visits_left, 292);
  assert.equal(ok.low, false); assert.equal(ok.warning, null);
  const low = tg.gasInfo(POL, 2200000000000n * 10n, null);
  assert.equal(low.visits_left_at_cap, 10); assert.equal(low.low, true); assert.match(low.warning, /about 10 more visits/);
  assert.match(tg.gasInfo(POL, 1n, null).warning, /no Base Sepolia gas/);
  assert.equal(tg.gasInfo(POL, null, null).low, null);
});
test('a signed record is never shown as just "signed"', () => {
  assert.equal(tg.phaseOf({ status: 'signed' }).phase, 'broadcasting');
  assert.equal(tg.phaseOf({ status: 'signed', base: { status: 'success' }, final: false }).label, 'Base Sepolia finalizing');
  assert.equal(tg.phaseOf({ status: 'signed', base: { status: 'success' }, final: true }).phase, 'settling');
  assert.equal(tg.phaseOf({ status: 'confirmed' }).phase, 'confirmed');
  for (const s of ['signed']) for (const b of [undefined, { status: 'success' }]) for (const f of [false, true]) assert.doesNotMatch(tg.phaseOf({ status: s, base: b, final: f }).label, /^signed$/);
});
test('the settler settles only final signed records, once, and needs no wallet', async () => {
  tg._resetSettler();
  const recs = { 0: { nonce: 0, status: 'confirmed' }, 1: { nonce: 1, status: 'signed', phase: 'finalizing', eta_s: 300, settle: null }, 2: { nonce: 2, status: 'signed', phase: 'settling', settle: { args: { nonce: 2, block_hash: '0xab' } } } };
  const sent = [];
  const opts = { read: async n => recs[n], send: async (s, gate, args) => { sent.push([gate, args]); return 'TX' + args.nonce; }, settler: { account: 'a.testnet' }, policyRead: async () => POL };
  const r = await tg.settleDue(opts);
  assert.deepEqual(r.records.map(x => [x.nonce, x.result]), [[1, 'waiting'], [2, 'sent']]);
  assert.equal(r.records[0].eta_s, 300);
  assert.equal(sent.length, 1); assert.deepEqual(sent[0][1], { nonce: 2, block_hash: '0xab' });
  await tg.settleDue(opts); assert.equal(sent.length, 1, 'no second settle within the cooldown');
  tg._resetSettler();
  assert.equal((await tg.settleOne(2, { ...opts, settler: null })).result, 'no_settler');
});
test('a room settle racing the sweep sends once and never errors', async () => {
  tg._resetSettler();
  const rec = { nonce: 8, status: 'signed', phase: 'settling', settle: { args: { nonce: 8 } } };
  let sent = 0;
  const opts = { read: async () => ({ ...rec }), send: async () => { sent++; await new Promise(r => setTimeout(r, 20)); rec.status = 'confirmed'; return 'TX8'; }, settler: { account: 'a.testnet' } };
  const [a, b] = await Promise.all([tg.settleOne(8, opts), tg.settleOne(8, opts)]);
  assert.equal(sent, 1);
  assert.ok(['sent', 'done'].includes(a.result) && ['sent', 'done'].includes(b.result));
  tg._resetSettler(); rec.status = 'signed';
  const failing = { ...opts, send: async () => { rec.status = 'confirmed'; throw new Error('already settled'); } };
  assert.equal((await tg.settleOne(8, failing)).result, 'done', 'a lost race reads as done, not a 500');
  tg._resetSettler(); rec.status = 'signed';
  await assert.rejects(tg.settleOne(8, { ...opts, send: async () => { throw new Error('rpc down'); } }), e => e.status === 502);
});
