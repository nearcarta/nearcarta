// The proof check must not read a rate limit as a missing transaction. A 429 says
// nothing about the tx, so the checker retries and then says found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAll, checkTx } from '../../src/mainnet-verify.js';

const TX = '4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia';
const dep = {
  root: 'nearcarta.near',
  extras: { arena: { contract: 'arena.nearcarta.near', txs: { arena_create_fund: TX } } },
};

const ok = (hash = TX) => ({ jsonrpc: '2.0', id: '1', result: { transaction: { signer_id: 'nearcarta.near' }, status: { SuccessValue: '' } } });
const limited = { jsonrpc: '2.0', id: '1', error: { code: -429, message: 'Rate limits exceeded.' } };
const reply = (body, status = 200) => ({ status, json: async () => body });

const noWait = async () => {};

test('a 429 is retried, not reported as a missing tx', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls < 3 ? reply(limited, 429) : reply(ok()));
  const one = await checkTx({ hash: TX, sender: 'nearcarta.near', rpc: 'https://rpc.example', fetchImpl, tries: 4, wait: noWait });
  assert.equal(one.found, true);
  assert.equal(calls, 3);
});

test('a real not-found is not retried', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return reply({ jsonrpc: '2.0', id: '1', error: { cause: { name: 'UNKNOWN_TRANSACTION' }, name: 'HANDLER_ERROR' } }); };
  const one = await checkTx({ hash: TX, sender: 'nearcarta.near', rpc: 'https://rpc.example', fetchImpl, tries: 4, wait: noWait });
  assert.equal(one.found, false);
  assert.equal(one.retry, undefined);
  assert.equal(calls, 1);
});

test('a dropped connection is retried', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; if (calls === 1) throw new Error('socket hang up'); return reply(ok()); };
  const one = await checkTx({ hash: TX, sender: 'nearcarta.near', rpc: 'https://rpc.example', fetchImpl, tries: 3, wait: noWait });
  assert.equal(one.found, true);
  assert.equal(calls, 2);
});

test('the full check still finds every row on a rate-limited RPC', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls % 2 ? reply(limited, 429) : reply(ok()));
  const out = await checkAll(dep, { rpc: ['https://rpc.example'], fetchImpl, tries: 4, wait: noWait, pauseMs: 0 });
  assert.equal(out.ok, true);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].found, true);
});
