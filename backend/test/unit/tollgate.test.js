import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gate, issuePass, checkPass, signPass, _clearUsed } from '../../src/tollgate.js';
import { otherNet, otherEvm, retiredNet } from '../../../shared/net/word-scan.js';

const ONE = '1000000000000000000000';
const secret = 'pass-secret-for-tests';

function tx({ signer = 'visitor.near', receiver = 'toll.nearcarta.near', amount = ONE, fail = null } = {}) {
  const body = {
    transaction: {
      signer_id: signer, receiver_id: 'board.nearcarta.near',
      actions: [{ FunctionCall: { method_name: 'propose', args: Buffer.from(JSON.stringify({ owner: signer, receiver, amount, signature: 'ab' })).toString('base64') } }],
    },
    receipts: fail ? [] : [{ receiver_id: receiver, receipt: { Action: { actions: [{ Transfer: { deposit: amount } }] } } }],
    status: fail ? { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: fail } } } } } : { SuccessValue: '' },
  };
  return body;
}

test('the toll gate is the mainnet contract', () => {
  const g = gate();
  assert.equal(g.network, 'mainnet');
  assert.equal(g.contract, 'toll.nearcarta.near');
  assert.equal(g.amount_near, '0.001');
  assert.equal(retiredNet.test(JSON.stringify(g)), false);
});

test('a 0.001 propose to the toll returns a pass', async () => {
  _clearUsed();
  const out = await issuePass({ hash: 'gate-ok-hash', signer: 'visitor.near', secret, status: async () => tx() });
  assert.equal(out.network, 'mainnet');
  assert.equal(out.payee, 'toll.nearcarta.near');
  assert.equal(checkPass(out.pass, secret), true);
  assert.equal(checkPass(out.pass, 'other'), false);
  _clearUsed();
});

test('a missing secret fails closed', async () => {
  _clearUsed();
  await assert.rejects(issuePass({ hash: 'gate-no-secret', signer: 'visitor.near', secret: '', status: async () => tx() }), e => e.status === 503);
});

test('a refusal does not get a pass', async () => {
  _clearUsed();
  await assert.rejects(issuePass({ hash: 'gate-refuse', signer: 'visitor.near', secret, status: async () => tx({ fail: 'over_per_action_cap' }) }), e => e.status === 400);
  _clearUsed();
});

test('the toll module source has no old-network settler', () => {
  const s = readFileSync(new URL('../../src/tollgate.js', import.meta.url), 'utf8') + readFileSync(new URL('../../src/toll-pass.js', import.meta.url), 'utf8');
  assert.equal(otherEvm.test(s), false);
  assert.equal(typeof signPass, 'function');
});

test('one toll tx buys one pass', async () => {
  _clearUsed();
  const out = await issuePass({ hash: 'gate-reuse', signer: 'visitor.near', secret, status: async () => tx() });
  assert.equal(out.network, 'mainnet');
  await assert.rejects(issuePass({ hash: 'gate-reuse', signer: 'visitor.near', secret, status: async () => tx() }), e => e.status === 409);
  _clearUsed();
});
