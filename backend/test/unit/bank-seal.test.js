import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seal, book, commitmentOf } from '../../src/bank-seal.js';
const M = 10n ** 21n;
const okTx = { transaction_outcome: { id: 'TX1', outcome: { tokens_burnt: '300000000000000000000' } }, receipts_outcome: [{ outcome: { tokens_burnt: '59000000000000000000', status: { SuccessValue: '' } } }] };
const deps = (over = {}) => { const sent = []; return { sent, send: async (a) => { sent.push(a); return okTx; }, balanceOf: async () => 18n * M, exists: async () => ({}), ...over }; };
const visitor = 'a'.repeat(64);
const digest = createHash('sha256').update(`${visitor}:1710000000000000000000:${'f'.repeat(32)}`).digest('hex');
test('bank seal: anchors the visitor digest from the keeper row; the salt never reaches the server', async () => {
  book.by.clear(); book.count = 0; const d = deps();
  const r = await seal({ account_id: visitor, digest }, d);
  assert.equal(r.ok, true); assert.equal(r.hash, 'TX1'); assert.equal(r.burnt_near, '0.000359');
  const call = d.sent[0].actions[0].functionCall;
  assert.equal(d.sent[0].receiverId, 'board.nearcarta.near'); assert.equal(call.methodName, 'anchor');
  const args = JSON.parse(Buffer.from(call.args).toString());
  assert.equal(args.kind, 'visitor_seal'); assert.equal(args.digest, digest); assert.match(args.salt, /^[0-9a-f]{24}$/);
  assert.equal(r.commitment, commitmentOf(args.salt, digest));
});
test('bank seal: one per visitor per day, a daily cap, and a keeper balance floor', async () => {
  book.by.clear(); book.count = 0;
  assert.equal((await seal({ account_id: visitor, digest }, deps())).ok, true);
  assert.equal((await seal({ account_id: visitor, digest }, deps())).why, 'ERR_SEAL_TODAY');
  assert.equal((await seal({ account_id: 'b'.repeat(64), digest }, deps({ balanceOf: async () => 4n * M }))).why, 'ERR_BANK_LOW');
  assert.equal((await seal({ account_id: 'c'.repeat(64), digest }, deps({ exists: async () => { throw new Error('no'); } }))).why, 'ERR_NO_ACCOUNT');
  assert.equal((await seal({ account_id: 'd'.repeat(64), digest: 'xyz' }, deps())).why, 'ERR_DIGEST');
  book.count = 60; assert.equal((await seal({ account_id: 'e'.repeat(64), digest }, deps())).why, 'ERR_SEAL_DAILY');
});
