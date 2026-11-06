import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectMainnetTxs, checkTx, checkAll } from '../../src/mainnet-verify.js';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };

test('mainnet proof rows include the charter allow and the over-cap refusal', () => {
  const rows = collectMainnetTxs(MAIN);
  const hashes = rows.map(r => r.hash);
  assert.ok(hashes.includes(MAIN.charter.txs['agent_propose_allowed_0.001']));
  assert.ok(hashes.includes(MAIN.charter.txs['agent_propose_over_cap_0.003']));
  assert.ok(rows.length >= 10);
});

test('a missing tx fails the check and a refusal still counts as found', async () => {
  const dep = { network: 'mainnet', root: 'nearcarta.near', charter: { contract: 'charter.nearcarta.near', txs: { allowed: 'A'.repeat(44), refused: 'B'.repeat(44) } } };
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const hash = body.params.tx_hash;
    if (hash.startsWith('A')) return { json: async () => ({ result: { transaction: { signer_id: 'charter.nearcarta.near' }, status: { SuccessValue: '' } } }) };
    if (hash.startsWith('B')) return { json: async () => ({ result: { transaction: { signer_id: 'charter.nearcarta.near' }, status: { Failure: { ActionError: {} } } } }) };
    return { json: async () => ({ error: { cause: { name: 'UNKNOWN_TRANSACTION' } } }) };
  };
  const ok = await checkTx({ hash: 'A'.repeat(44), sender: 'nearcarta.near', rpc: 'https://rpc.example', fetchImpl });
  assert.equal(ok.found, true);
  assert.equal(ok.success, true);
  const all = await checkAll(dep, { rpc: 'https://rpc.example', fetchImpl });
  assert.equal(all.ok, true);
  assert.equal(all.rows.find(r => r.label === 'refused').failure, true);
  const miss = await checkAll({ root: 'nearcarta.near', toll: { contract: 'toll.nearcarta.near', txs: { gone: 'C'.repeat(44) } } }, { rpc: 'https://rpc.example', fetchImpl });
  assert.equal(miss.ok, false);
});

test('a rate-limited RPC is retried and never reported as a missing tx', async () => {
  // The archival RPC returns -429 under load. Treating that as "not found" made
  // `npm run verify` fail at random (10/71, 64/71, 70/71 on the same tree).
  const dep = { network: 'mainnet', root: 'nearcarta.near', guard: { contract: 'guard.nearcarta.near', txs: { deploy: 'D'.repeat(44) } } };
  let calls = 0;
  const throttled = async () => {
    calls += 1;
    if (calls <= 2) return { status: 429, json: async () => ({ error: { code: -429, name: 'RATE_LIMITED', message: 'Rate limits exceeded' } }) };
    return { status: 200, json: async () => ({ result: { transaction: { signer_id: 'nearcarta.near' }, status: { SuccessValue: '' } } }) };
  };
  const out = await checkAll(dep, { rpc: 'https://rpc.example', fetchImpl: throttled, backoffMs: 1 });
  assert.equal(calls, 3, 'the throttle should be retried');
  assert.equal(out.ok, true, 'a retried throttle must still find the tx');
  assert.equal(out.rows[0].found, true);
});

test('a tx that stays throttled is reported as throttled, not as missing', async () => {
  const dep = { network: 'mainnet', root: 'nearcarta.near', guard: { contract: 'guard.nearcarta.near', txs: { deploy: 'E'.repeat(44) } } };
  const always = async () => ({ status: 429, json: async () => ({ error: { code: -429, name: 'RATE_LIMITED' } }) });
  const out = await checkAll(dep, { rpc: 'https://rpc.example', fetchImpl: always, tries: 2, backoffMs: 1 });
  assert.equal(out.ok, false, 'an unanswered check is not a pass');
  assert.equal(out.rows[0].throttled, true);
  assert.equal(out.rows[0].found, false);
});
