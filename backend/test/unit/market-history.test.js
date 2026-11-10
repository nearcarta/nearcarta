import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineFor, replay } from '../../../shared/market/replay.js';
import { history, _reset } from '../../src/market-history.js';

const row = (method, args, by, ok = true, ts = '1794274435495598517', hash = 'H' + method) => ({ predecessor_account_id: by, transaction_hash: hash, block_timestamp: ts, receipt_outcome: { status: ok }, actions: [{ action: 'FUNCTION_CALL', method, args: JSON.stringify(args) }] });

test('replay: plain lines, oldest first, refusals kept, setup noise dropped', () => {
  const ev = replay([
    row('sell', { shop: 'arena', good: 'good:salt', qty: 3 }, 'ab'.repeat(32), true, '1794274439000000000'),
    row('keeper_take', { shop: 'arena' }, 'ab'.repeat(32), false, '1794274438000000000'),
    row('set_node', { node: 'ferry-1' }, 'nearcarta.near'),
    row('new', {}, 'nearcarta.near', true, '1794274430000000000'),
    row('attempt', {}, 'old.near', true, '1794274420000000000'),
  ]);
  assert.deepEqual(ev.map((e) => e.kind), ['refused', 'trade']);
  assert.match(ev[1].line, /A visitor sold 3 salt to the Vault Arena/);
  assert.equal(lineFor({ method: 'council', args: { yes: true }, ok: true, by: 'keeper-ferry.nearcarta.near' }).line, 'The Ferry keeper voted yes');
});

test('history: reads one index page and caches it', async () => {
  _reset(); let calls = 0;
  const fetchF = async () => { calls++; return { ok: true, json: async () => ({ txns: [row('stall', { stall: 1, action: 'rent' }, 'ab'.repeat(32))] }) }; };
  const a = await history({ fetchF }); const b = await history({ fetchF });
  assert.equal(calls, 1); assert.equal(a.events[0].kind, 'stall'); assert.equal(b.events.length, 1);
});
