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

test('council: a keeper sees the rule change in plain numbers before voting', async () => {
  const { councilMessages } = await import('../../../shared/market/keeper-ai.js');
  const m = councilMessages('ferry', 'floor_bps', '9000', 'slow days', { rules: { floor_bps: 10000 }, floor: '3000000000000000000000' })[1].content;
  assert.match(m, /Now 10000 \(100%\), proposed 9000 \(90%\)/);
  assert.match(m, /today it closes below 0\.003 NEAR; after the change, below 0\.0027 NEAR/);
  assert.match(m, /Reason given: slow days/);
});

test('restock: a keeper sees the price it would pay next to its own selling price', async () => {
  const { restockMessages } = await import('../../../shared/market/keeper-ai.js');
  const board = [{ id: 'hall', till: '10000000000000000000000', floor: '2700000000000000000000', goods: [{ good: 'good:iron', stock: '20', quote: { buy: '2000000000000000000000' } }] }];
  const m = restockMessages('hall', board, [{ good: 'good:iron', from: 'arena', price: '1904600000000000000000', my_price: '2000000000000000000000', my_stock: 20, their_stock: 21 }])[1].content;
  assert.match(m, /buy iron from arena at 1\.904 milliNEAR each; my own shop sells it at 2 /);
  assert.match(m, /Till 10 milliNEAR, floor 2\.7 milliNEAR/);
});
