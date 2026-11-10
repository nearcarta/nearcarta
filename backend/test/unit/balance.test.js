// readBalance against a mocked RPC: no network, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBalance, contractOf, formatUnits, balanceLine } from '../../../app/src/panels/balance.js';

/** A stub that records the call and answers with base64 bytes of a JSON string. */
function stubRpc(answer) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    return answer(params);
  };
  return { rpc, calls };
}

const enc = (s) => Buffer.from(s, 'utf8').toString('base64');
const ftAnswer = (raw) => () => ({ result: enc(JSON.stringify(raw)) });

test('a NEP-141 token reads ft_balance_of on the contract, not the asset id', async () => {
  const { rpc, calls } = stubRpc(ftAnswer('177937'));
  const out = await readBalance('alice.near', { symbol: 'USDC', decimals: 6, assetId: 'nep141:17208628f84f5d6' }, { rpc });

  assert.equal(out.ok, true);
  assert.equal(out.raw, '177937');
  assert.equal(out.value, 0.177937);
  assert.equal(out.contract, '17208628f84f5d6', 'the nep141: prefix is stripped');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.request_type, 'call_function');
  assert.equal(calls[0].params.account_id, '17208628f84f5d6');
  assert.equal(calls[0].params.method_name, 'ft_balance_of');
  assert.deepEqual(JSON.parse(Buffer.from(calls[0].params.args_base64, 'base64').toString()), { account_id: 'alice.near' });
});

test('NEAR reads view_account.amount and uses 24 decimals', async () => {
  const { rpc, calls } = stubRpc(() => ({ amount: '453055282996503599999996', locked: '0' }));
  const out = await readBalance('alice.near', { symbol: 'NEAR', decimals: 24 }, { rpc });

  assert.equal(out.ok, true);
  assert.equal(out.value, 0.4530552829965036);
  assert.equal(calls[0].params.request_type, 'view_account');
  assert.equal(calls[0].params.account_id, 'alice.near');
});

test('a zero balance is a real zero, not a failure', async () => {
  const { rpc } = stubRpc(ftAnswer('0'));
  const out = await readBalance('alice.near', { symbol: 'wNEAR', decimals: 24, assetId: 'nep141:wrap.near' }, { rpc });
  assert.equal(out.ok, true);
  assert.equal(out.value, 0);
  assert.equal(balanceLine(out), 'Balance: 0 wNEAR');
});

test('nobody signed in reads nothing and shows nothing', async () => {
  const { rpc, calls } = stubRpc(ftAnswer('1'));
  const out = await readBalance('', { symbol: 'USDC', decimals: 6 }, { rpc });
  assert.equal(out.ok, false);
  assert.equal(balanceLine(out), '');
  assert.equal(calls.length, 0, 'no RPC call without an account');
});

test('a transport error is reported, never rendered as a number', async () => {
  const rpc = async () => { throw new Error('rpc busy'); };
  const out = await readBalance('alice.near', { symbol: 'USDC', decimals: 6, assetId: 'nep141:x' }, { rpc });
  assert.equal(out.ok, false);
  assert.match(out.reason, /rpc busy/);
  assert.equal(balanceLine(out), '');
});

test('an empty result is a failure, not zero', async () => {
  const rpc = async () => ({ result: '' });
  const out = await readBalance('alice.near', { symbol: 'USDC', decimals: 6, assetId: 'nep141:x' }, { rpc });
  assert.equal(out.ok, false);
  assert.equal(balanceLine(out), '');
});

test('contractOf prefers an explicit contract and strips the prefix', () => {
  assert.equal(contractOf({ contract: 'wrap.near' }), 'wrap.near');
  assert.equal(contractOf({ contract: 'nep141:wrap.near' }), 'wrap.near');
  assert.equal(contractOf({ assetId: 'nep141:usdc.near' }), 'usdc.near');
  assert.equal(contractOf({}), '');
});

test('formatUnits refuses rubbish instead of quietly returning NaN', () => {
  assert.equal(formatUnits('1000000', 6), 1);
  assert.equal(formatUnits('abc', 6), null);
  assert.equal(formatUnits(null, 6), null);
  assert.equal(formatUnits('1', -1), null);
  assert.equal(formatUnits('1', 99), null);
});
