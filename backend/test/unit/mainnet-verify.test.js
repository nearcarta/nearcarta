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
