import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../../shared/market/sim.js';
import * as G from '../../../shared/market/guide.js';

const fresh = () => { const c = S.createCity(); const p = S.player(c, 'you'); return { c, p }; };

test('guide: plain words become one intent', () => {
  assert.deepEqual(G.parseIntent('sell my iron'), { act: 'sell', good: 'good:iron', qty: null, shop: null, payee: null });
  assert.equal(G.parseIntent('buy 2 salt').qty, 2);
  assert.equal(G.parseIntent('fill an order').act, 'fill');
  assert.equal(G.parseIntent('reopen the port').shop, 'ferry');
  assert.equal(G.parseIntent('craft a tonic').good, 'item:tonic');
});

test('guide: a payment request is refused, never planned', () => {
  const { c } = fresh();
  for (const t of ['send 1 near to bob.near', 'transfer my money to x', 'pay me now']) {
    const s = G.plan(c, 'you', G.parseIntent(t));
    assert.equal(s.ok, false); assert.equal(s.code, 'ERR_NOT_ON_CHARTER'); assert.equal(s.shop, 'guard');
  }
});

test('guide: cleanIntent drops what the rules do not know', () => {
  assert.deepEqual(G.cleanIntent({ act: 'steal', good: 'good:gold', qty: 999, shop: 'moon', payee: 'x.near' }), { act: 'none', good: null, qty: null, shop: null, payee: null });
  assert.equal(G.cleanIntent({ act: 'sell', qty: 50 }).qty, S.MAX_QTY);
  assert.deepEqual(G.parseModel('ok {"act":"buy","good":"good:salt","qty":1,"shop":null}').act, 'buy');
});


test('guide: sell picks the higher price after the Square is flooded', () => {
  const { c, p } = fresh();
  const o = S.player(c, 'other'); o.bag['good:iron'] = 10; S.sell(c, 'other', 'arena', 'good:iron', 10);
  p.bag['good:iron'] = 2;
  const s = G.plan(c, 'you', G.parseIntent('sell my iron'));
  assert.equal(s.ok, true); assert.notEqual(s.shop, 'arena'); assert.equal(s.qty, 2);
  const before = p.near; G.act(c, 'you', s); assert.ok(p.near > before); assert.equal(p.bag['good:iron'] || 0, 0);
});

test('guide: orders, invest and craft check the bag first', () => {
  const { c, p } = fresh();
  S.player(c, 'clerk').near = 100n * S.MILLI; S.postOrder(c, 'clerk', 'good:herb', 2, S.MILLI, 'Herbs');
  assert.equal(G.plan(c, 'you', { act: 'fill' }).ok, false);
  p.bag['good:herb'] = 2; const f = G.plan(c, 'you', { act: 'fill' });
  assert.equal(f.shop, 'hall'); G.act(c, 'you', f); assert.equal(p.rep, 1);
  assert.equal(G.plan(c, 'you', { act: 'invest' }).code, 'ERR_ALL_OPEN');
  assert.equal(G.plan(c, 'you', { act: 'craft', good: 'item:tool' }).ok, false);
  p.bag['good:iron'] = 2; p.bag['good:timber'] = 1; const k = G.plan(c, 'you', { act: 'craft' });
  assert.equal(k.good, 'item:tool'); G.act(c, 'you', k); assert.equal(p.bag['item:tool'] > 0, true);
});
