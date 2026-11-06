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

test('a throttled RPC is retried and never reads as a missing proof', async () => {
  const dep = { network: 'mainnet', root: 'nearcarta.near', house: { contract: 'house.nearcarta.near', txs: { deploy: 'D'.repeat(44) } } };
  let calls = 0;
  const throttledThenFound = async () => {
    calls += 1;
    if (calls <= 2) return { status: 429, json: async () => ({ error: { name: 'TooManyRequests', message: 'rate limited' } }) };
    return { status: 200, json: async () => ({ result: { transaction: { signer_id: 'nearcarta.near' }, status: { SuccessValue: '' } } }) };
  };
  const all = await checkAll(dep, { rpc: 'https://rpc.example', fetchImpl: throttledThenFound, retryMs: 1, paceMs: 0 });
  assert.equal(all.ok, true, 'a rate-limited endpoint must not turn a real tx into a missing one');
  assert.ok(calls >= 3, 'it asks again before giving up');

  // A JSON-RPC "unknown transaction" is an answer, so it is not retried for being transient.
  let asks = 0;
  const unknown = async () => { asks += 1; return { status: 200, json: async () => ({ error: { cause: { name: 'UNKNOWN_TRANSACTION' } } }) }; };
  const gone = await checkAll(dep, { rpc: 'https://rpc.example', fetchImpl: unknown, retryMs: 1, paceMs: 0 });
  assert.equal(gone.ok, false);
  assert.notEqual(gone.rows[0].transient, true, 'an absent tx is a final answer, not a transient failure');
  assert.ok(asks < 6, 'it is not asked about three full rounds');

  // A network failure is transient: retried, then reported as such rather than as an absent tx.
  let fails = 0;
  const throwing = async () => { fails += 1; return { status: 502, json: async () => { throw new Error('bad gateway'); } }; };
  const down = await checkAll(dep, { rpc: 'https://rpc.example', fetchImpl: throwing, retryMs: 1, paceMs: 0 });
  assert.equal(down.ok, false);
  assert.equal(down.rows[0].transient, true);
  assert.ok(fails >= 3);
});

test('one hash cited by two records is read once', async () => {
  const hash = 'E'.repeat(44);
  const dep = { network: 'mainnet', root: 'nearcarta.near',
    retired: { 'house.nearcarta.near@v2': { contract: 'house.nearcarta.near', txs: { close: hash } } },
    house: { contract: 'house.nearcarta.near', txs: { close: hash } } };
  let reads = 0;
  const found = async () => { reads += 1; return { status: 200, json: async () => ({ result: { transaction: { signer_id: 'nearcarta.near' }, status: { SuccessValue: '' } } }) }; };
  const out = await checkAll(dep, { rpc: 'https://rpc.example', fetchImpl: found, paceMs: 0 });
  assert.equal(out.ok, true);
  assert.equal(out.rows.length, 2, 'both records still appear in the report');
  assert.equal(reads, 1, 'the same hash is not fetched twice');
});
