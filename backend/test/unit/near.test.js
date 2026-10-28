import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsFromOutcome, txResult } from '../../src/near.js';

const ev = (event, extra = {}) => 'EVENT_JSON:' + JSON.stringify({ standard: 'oath', version: '2.0.0', event, data: [extra] });
const o = (id, logs, status = { SuccessValue: '' }) => ({ id, outcome: { logs, status, executor_id: 'x.testnet', gas_burnt: 1 } });

test('events from failed receipts are dropped as phantoms', () => {
  const tx = { transaction_outcome: o('t', []), receipts_outcome: [o('a', [ev('action', { decision: 'allowed' })]),
    o('b', [ev('settled')], { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: 'Exceeded the prepaid gas.' } } } } })] };
  const r = eventsFromOutcome(tx);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].event, 'action');
  assert.equal(r.dropped, 1);
});

test('malformed and non-NEP-297 logs are ignored', () => {
  const tx = { transaction_outcome: o('t', ['hello', 'EVENT_JSON:{bad', 'EVENT_JSON:{"x":1}']), receipts_outcome: [] };
  assert.equal(eventsFromOutcome(tx).events.length, 0);
});

test('txResult decodes SuccessValue and reports the first failure', () => {
  const v = Buffer.from(JSON.stringify({ decision: 'denied' })).toString('base64');
  assert.deepEqual(txResult({ status: { SuccessValue: v }, receipts_outcome: [] }).value, { decision: 'denied' });
  const f = txResult({ status: {}, receipts_outcome: [o('b', [], { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: ERR_FROZEN' } } } } })] });
  assert.equal(f.ok, false);
  assert.match(f.error, /ERR_FROZEN/);
});

test('rpc moves to the fallback endpoint on 429 and keeps RPC errors as answers', async () => {
  const { rpc } = await import('../../src/near.js');
  const { cfg } = await import('../../src/config.js');
  const saved = { fetch: globalThis.fetch, fb: cfg.rpcFallbacks };
  const hits = [];
  cfg.rpcFallbacks = ['https://fallback.invalid'];
  globalThis.fetch = async (u) => {
    hits.push(u);
    if (u === cfg.rpc) return new Response('slow down', { status: 429 });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: 1 } }), { status: 200 });
  };
  try {
    assert.deepEqual(await rpc('status', []), { ok: 1 });
    assert.deepEqual(hits, [cfg.rpc, 'https://fallback.invalid']);
    hits.length = 0;
    globalThis.fetch = async (u) => { hits.push(u); return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT' } } }), { status: 200 }); };
    await assert.rejects(rpc('query', {}), /UNKNOWN_ACCOUNT/);
    assert.equal(hits.length, 1);
  } finally { globalThis.fetch = saved.fetch; cfg.rpcFallbacks = saved.fb; }
});
