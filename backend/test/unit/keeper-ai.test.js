import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restockChoices, parseRestock, parseVote, checkRule } from '../../../shared/market/keeper-ai.js';
import { ask, restockCall } from '../../src/keepers.js';

const g = (good, stock, buy) => ({ good, stock: String(stock), quote: { buy: String(buy), sell: '1' } });
const board = [
  { id: 'ferry', open: true, till: '10', floor: '3', goods: [g('good:salt', 17, 900), g('good:timber', 20, 700)] },
  { id: 'bank', open: true, till: '10', floor: '3', goods: [g('good:salt', 20, 950)] },
  { id: 'hall', open: false, till: '1', floor: '3', goods: [g('good:salt', 22, 800)] },
];

test('keeper choices: only goods it trades, only from open fuller shops', () => {
  const c = restockChoices(board, 'ferry');
  assert.deepEqual(c.map((x) => [x.good, x.from]), [['good:salt', 'bank']]);
});

test('the model can only pick a listed move, at most 2 units', () => {
  const c = restockChoices(board, 'ferry');
  assert.equal(parseRestock('{"pick":0}', c), null);
  assert.equal(parseRestock('{"pick":5,"qty":1}', c), null);
  const r = parseRestock('ok {"pick":1,"qty":9,"why":"low salt"}', c);
  assert.equal(r.qty, 2); assert.equal(r.from, 'bank');
  assert.equal(parseVote('{"yes":true}').yes, true);
  assert.equal(parseVote('{"yes":"yes"}').yes, false);
  assert.ok(checkRule('floor_bps', 8000)); assert.ok(!checkRule('floor_bps', 100)); assert.ok(!checkRule('owner', 1));
});

test('an unverified answer never moves a keeper', async () => {
  process.env.NEARAI_CLOUD_API_KEY = 'test';
  const deps = { models: ['m'], pf: async () => ({ ok: true }), completeF: async () => ({ id: 'c1', model: 'm', content: '{"yes":true}', usage: {} }), signatureF: async () => ({ available: false }) };
  const r = await ask([{ role: 'user', content: 'x' }], parseVote, deps);
  assert.equal(r.reply, null); assert.equal(r.why, 'signature not verified');
  delete process.env.NEARAI_CLOUD_API_KEY;
});

test('restock call carries the decision and a capped deposit', () => {
  const c = restockCall('ferry', { from: 'bank', good: 'good:salt', qty: 2, price: '1000' }, 'chatcmpl-1');
  const a = JSON.parse(c.args);
  assert.equal(a.decision, 'chatcmpl-1'); assert.equal(a.max_total, '2100'); assert.equal(c.deposit, '2100');
});
