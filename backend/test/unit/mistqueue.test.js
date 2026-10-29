// Mist Bank send queue (src/mistqueue.js): address checks, the approval read-back, limits, and the
// worker sync whitelist. The fixture addresses are fresh testnet receive-only addresses made for this test.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as mq from '../../src/mistqueue.js';
import { makeApp } from '../../src/app.js';

const UA = 'utest1j909tzez2xgzrxpkqcksy8zm0835k2n7aussu8yz8quh3jhs7k4umy7smdgd0h6tj5frkv0sxcfwgjv9zt5mqv6sxmqmqunw65fu9z20';
const UA_MIXED = 'utest1cpcdux7s9p92tqwrmg02zcxett5rzucy5htyrysahl78augy3yvw2pn2mshjaysq5jlqkrhzx8v56lguceftqerdmk94qzxsgynrrvpga5ej2mxjku67a4u09qx5tkdfsrlvyw88prtwv0fyr4lvhafjfda098nsxkdzfvyxxvn29ngz';
const CHARTER = 'visitor.nccharters-85831.testnet';
const TX = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const T0 = Date.parse('2026-10-28T06:00:00Z');
const sha = s => createHash('sha256').update(s).digest('hex');
beforeEach(() => mq._reset());

function chain({ memo = mq.queueMemo(UA), shop = 'mistbank', decision = 'allowed', signer = CHARTER, code = mq.OATH_HASHES[0], fak = 0, ageMs = 60e3, phantom = false } = {}) {
  const args = Buffer.from(JSON.stringify({ p: { shop, clause_id: 'pay', memo } })).toString('base64');
  const ev = { standard: 'oath', version: '2.0.0', event: 'action', data: [{ agent: CHARTER, shop, clause_id: 'pay', decision, memo_hash: sha(memo) }] };
  return {
    viewAccount: async () => ({ code_hash: code }),
    accessKeys: async () => ({ keys: [...Array(fak)].map(() => ({ access_key: { permission: 'FullAccess' } })).concat([{ access_key: { permission: { FunctionCall: {} } } }]) }),
    txStatus: async () => ({ status: { SuccessValue: '' }, transaction: { signer_id: signer, receiver_id: CHARTER, actions: [{ FunctionCall: { method_name: 'propose', args } }] },
      transaction_outcome: { id: 'a', block_hash: 'b', outcome: { executor_id: CHARTER, logs: [], status: {} } },
      receipts_outcome: [{ id: 'r', outcome: { executor_id: CHARTER, logs: ['EVENT_JSON:' + JSON.stringify(ev)], status: phantom ? { Failure: { x: 1 } } : { SuccessValue: '' } } }] }),
    rpc: async () => ({ header: { timestamp: String(BigInt(T0 - ageMs) * 1000000n) } }),
  };
}
const verify = (o) => mq.verifyApproval({ ua: UA, charter: CHARTER, approval_tx: TX }, { now: T0, chain: chain(o) });

test('address: Orchard-only testnet UA passes; mixed receivers, mainnet and junk are refused', () => {
  assert.deepEqual(mq.checkUa(UA).receivers, ['Orchard']);
  assert.throws(() => mq.checkUa(UA_MIXED), /exactly one receiver, Orchard/);
  assert.throws(() => mq.checkUa('u1' + UA.slice(6)), /testnet unified address/);
  assert.throws(() => mq.checkUa('utest1abc'), /does not decode/);
  assert.throws(() => mq.checkUa({}), /testnet unified address/);
});
test('memo binds the address and fits the 64-byte oath memo', () => {
  const m = mq.queueMemo(UA);
  assert.match(m, /^mbq1:[A-Za-z0-9_-]{43}$/);
  assert.ok(m.length <= 64);
  assert.notEqual(m, mq.queueMemo(UA_MIXED));
  assert.equal(mq.prepare(UA).memo, m);
});
test('approval read-back: a fresh allowed proposal from the charter itself passes', async () => {
  const a = await verify();
  assert.equal(a.charter, CHARTER);
  assert.equal(a.clause_id, 'pay');
});
test('approval read-back refuses every way it can be wrong', async () => {
  await assert.rejects(verify({ memo: mq.queueMemo(UA_MIXED) }), /memo/);
  await assert.rejects(verify({ shop: 'bakery' }), /shop "mistbank"/);
  await assert.rejects(verify({ decision: 'blocked' }), /did not allow/);
  await assert.rejects(verify({ phantom: true }), /did not allow/);
  await assert.rejects(verify({ signer: 'someone.testnet' }), /signed by the charter/);
  await assert.rejects(verify({ code: 'x'.repeat(44) }), /published oath build/);
  await assert.rejects(verify({ fak: 1 }), /full-access key/);
  await assert.rejects(verify({ ageMs: 25 * 3600e3 }), /older than 24 h/);
  await assert.rejects(mq.verifyApproval({ ua: UA, charter: 'bad', approval_tx: TX }, { chain: chain() }), /testnet account/);
});

const ok = async () => ({ approved_at: new Date(T0).toISOString(), url: 'u', clause_id: 'pay' });
const body = (o = {}) => ({ ua: UA, charter: CHARTER, approval_tx: TX, ...o });
test('queue is closed while the worker is offline', async () => {
  await assert.rejects(mq.enqueue(body(), { now: T0, verify: ok }), e => e.status === 503);
});
test('queue: one per charter per day, an approval tx works once, global daily cap', async () => {
  mq.sync([], { now: T0 });
  const q = await mq.enqueue(body(), { now: T0, verify: ok });
  assert.equal(q.state, 'queued');
  await assert.rejects(mq.enqueue(body(), { now: T0, verify: ok }), e => e.status === 409);
  await assert.rejects(mq.enqueue(body({ approval_tx: TX.replace('9', '8') }), { now: T0, verify: ok }), e => e.status === 429);
  for (let i = 1; i < mq.LIMITS.global_per_day; i++)
    await mq.enqueue(body({ charter: `v${i}.nccharters-85831.testnet`, approval_tx: TX.slice(0, -2) + String(i).padStart(2, 'A') }), { now: T0, verify: ok });
  await assert.rejects(mq.enqueue(body({ charter: 'late.nccharters-85831.testnet', approval_tx: TX.slice(0, -2) + 'zz' }), { now: T0, verify: ok }), /daily limit/);
});
test('worker sync: hands out the address once, keeps only whitelisted fields, status never shows address, amount or salt', async () => {
  mq.sync([], { now: T0 });
  const { id } = await mq.enqueue(body(), { now: T0, verify: ok });
  const p1 = mq.sync([], { now: T0 + 1000 }).pending;
  assert.equal(p1.length, 1); assert.equal(p1[0].ua, UA);
  const rec = { id, charter: CHARTER, approval_tx: TX, queued_at: new Date(T0).toISOString(), state: 'waiting' };
  assert.equal(mq.sync([rec], { now: T0 + 2000 }).pending.length, 0);
  const txid = 'ab'.repeat(32), commitment = 'cd'.repeat(32);
  mq.sync([{ ...rec, state: 'sent', sent_at: new Date(T0 + 9e5).toISOString(), txid, commitment, zats: 12345, salt: 'ff'.repeat(16), ua: UA }], { now: T0 + 9e5 });
  const s = mq.status(id);
  assert.equal(s.state, 'sent'); assert.equal(s.zcash.txid, txid); assert.equal(s.commitment.value, commitment);
  const text = JSON.stringify(s);
  for (const leak of [UA, '12345', 'ff'.repeat(16), 'zats', 'salt=']) assert.ok(!text.includes(leak), leak);
});
test('worker sync rebuilds status after a restart and drops malformed records', () => {
  const rec = { id: 'e'.repeat(32), charter: CHARTER, approval_tx: TX, queued_at: new Date(T0).toISOString(), state: 'sent', txid: 'nothex', commitment: 'cd'.repeat(32) };
  mq.sync([rec, { id: 'x', state: 'sent' }, { ...rec, id: 'f'.repeat(32), state: 'failed', error: 'Error: /secret/path' }], { now: T0 + 1000 });
  assert.equal(mq.status('e'.repeat(32), T0 + 1000).state, 'sending'); // a sent claim without a real txid is not shown as sent
  assert.equal(mq.status('f'.repeat(32)).error, 'failed');
  assert.throws(() => mq.status('x'), /bad id/);
});
test('worker token: unset, short or wrong token is refused', () => {
  const tok = 't'.repeat(40);
  assert.equal(mq.workerAuth('Bearer ' + tok, tok), true);
  assert.equal(mq.workerAuth('Bearer ' + tok, undefined), false);
  assert.equal(mq.workerAuth('Bearer short', 'short'), false);
  assert.equal(mq.workerAuth('Bearer ' + tok.slice(1) + 'u', tok), false);
});
test('routes: worker sync needs the token; send is 503 while the worker is offline; info states no amount', async () => {
  const app = makeApp();
  const h = { 'content-type': 'application/json', 'cf-connecting-ip': '7.7.7.7' };
  const r1 = await app.request('/api/mistbank/worker/sync', { method: 'POST', headers: h, body: '{"records":[]}' });
  assert.equal(r1.status, 401);
  const r2 = await app.request('/api/mistbank/send', { method: 'POST', headers: h, body: JSON.stringify(body()) });
  assert.equal(r2.status, 503);
  const r3 = await app.request('/api/mistbank/send/prepare', { method: 'POST', headers: h, body: JSON.stringify({ ua: UA }) });
  assert.equal((await r3.json()).memo, mq.queueMemo(UA));
  const info = await (await app.request('/api/mistbank/send', { headers: h })).text();
  assert.ok(!/zats|\d{4,} ?TAZ/.test(info));
});
