import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gate, issuePass, checkPass, signPass } from '../../src/tollgate.js';

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
  assert.equal(/sepolia|testnet/i.test(JSON.stringify(g)), false);
});

test('a 0.001 propose to the toll returns a pass', async () => {
  const out = await issuePass({ hash: 'h', signer: 'visitor.near', secret, status: async () => tx() });
  assert.equal(out.network, 'mainnet');
  assert.equal(out.payee, 'toll.nearcarta.near');
  assert.equal(checkPass(out.pass, secret), true);
  assert.equal(checkPass(out.pass, 'other'), false);
});

test('a missing secret fails closed', async () => {
  await assert.rejects(issuePass({ hash: 'h', signer: 'visitor.near', secret: '', status: async () => tx() }), e => e.status === 503);
});

test('a refusal does not get a pass', async () => {
  await assert.rejects(issuePass({ hash: 'h', signer: 'visitor.near', secret, status: async () => tx({ fail: 'over_per_action_cap' }) }), e => e.status === 400);
});

test('the toll module source has no sepolia settler', () => {
  const s = readFileSync(new URL('../../src/tollgate.js', import.meta.url), 'utf8') + readFileSync(new URL('../../src/toll-pass.js', import.meta.url), 'utf8');
  assert.equal(/sepolia/i.test(s), false);
  assert.equal(typeof signPass, 'function');
});
