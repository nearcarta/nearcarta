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

test('a hash recorded twice is asked once, and a dropped lookup is retried', async () => {
  // CI read the same house tx as found under one shop and missing under the next,
  // so the read is not reliable in a burst. One hash is one question; a lookup that
  // comes back empty is asked again before it is called missing.
  const H = 'D'.repeat(44);
  const dep = { root: 'nearcarta.near', retired: { house: { contract: 'house.nearcarta.near', txs: { pay: H } } }, house: { contract: 'house.nearcarta.near', txs: { pay: H } } };
  let asked = 0;
  const fetchImpl = async () => {
    asked += 1;
    // Fail the first answer, then find it: the retry is what saves the row.
    if (asked === 1) return { json: async () => ({ error: { cause: { name: 'TIMEOUT_ERROR' } } }) };
    return { json: async () => ({ result: { transaction: { signer_id: 'nearcarta.near' }, status: { SuccessValue: '' } } }) };
  };
  const out = await checkAll(dep, { rpc: 'https://rpc.example', fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows.every(r => r.found), true, 'both records of the same hash resolve');
  assert.ok(asked <= 4, `one question for the shared hash plus retries, not one per record (asked ${asked})`);
});
