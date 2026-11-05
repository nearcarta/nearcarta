import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../../src/app.js';
import { issuePass, checkPass, signPass, _clearUsed } from '../../src/toll-pass.js';
import { BOARD, judgePropose, MAX_YOCTO, verifyPropose } from '../../src/board-tx.js';

const VISITOR = 'alice.near';
const TOLL = 'toll.nearcarta.near';
const HASH = '4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia';
const ONE = '1000000000000000000000';

function tx({ signer = VISITOR, receiver = TOLL, amount = ONE, fail = null } = {}) {
  return {
    transaction: {
      signer_id: signer, receiver_id: BOARD,
      actions: [{ FunctionCall: { method_name: 'propose', args: Buffer.from(JSON.stringify({ owner: signer, receiver, amount, signature: 'ab' })).toString('base64') } }],
    },
    receipts: fail ? [] : [{ receiver_id: receiver, receipt: { Action: { actions: [{ Transfer: { deposit: amount } }] } } }],
    status: fail ? { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: fail } } } } } : { SuccessValue: '' },
  };
}

test('board propose judge matches payee and amount', () => {
  const j = judgePropose(tx(), { signer: VISITOR, expectReceiver: TOLL, maxYocto: MAX_YOCTO });
  assert.equal(j.ok, true);
  assert.equal(j.decision, 'allowed');
  assert.equal(j.receiver, TOLL);
  assert.equal(j.amount, ONE);
});

test('one toll tx buys one pass: reuse is 409', async () => {
  const secret = 'pass-secret-for-paths';
  _clearUsed();
  const status = async () => tx();
  const a = await issuePass({ hash: HASH, signer: VISITOR, secret, status, now: 1_000 });
  assert.equal(a.network, 'mainnet');
  assert.equal(checkPass(a.pass, secret), true);
  await assert.rejects(issuePass({ hash: HASH, signer: VISITOR, secret, status, now: 2_000 }), e => e.status === 409 && /already issued a pass/.test(e.message));
  _clearUsed();
});

test('missing TOLL_PASS_SECRET fails closed with 503', async () => {
  _clearUsed();
  await assert.rejects(issuePass({ hash: HASH, signer: VISITOR, secret: '', status: async () => tx() }), e => e.status === 503);
});

test('POST /api/toll/mainnet validates body shape', async () => {
  const res = await makeApp().request('/api/toll/mainnet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx: 'short', signer: VISITOR }) });
  assert.equal(res.status, 400);
});

test('signPass without secret throws 503', () => {
  assert.throws(() => signPass({ hash: HASH }, null), e => e.status === 503);
});

void verifyPropose;
