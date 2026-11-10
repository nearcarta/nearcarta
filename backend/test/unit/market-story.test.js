import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../../shared/market/sim.js';
import * as Q from '../../../shared/market/story.js';

test('story: nine steps, one per shop, every shop once', () => {
  assert.equal(Q.STEPS.length, 9);
  assert.equal(new Set(Q.STEPS.map((s) => s.shop)).size, 9);
  for (const s of Q.STEPS) { assert.ok(s.need.length <= 26, s.need); assert.ok(s.btn.length <= 14, s.btn); assert.ok(s.intro.length <= 60, s.intro); }
});

test('story: a new merchant earns a first coin in one day', () => {
  const c = S.createCity(); const p = S.player(c, Q.ME);
  assert.throws(() => Q.act(c, 'arena'), /ERR_WRONG_SHOP/);
  for (const s of Q.STEPS) {
    const r = Q.act(c, s.shop); assert.ok(r.line);
    if (s.id === 'cargo') { assert.equal(p.bag['good:salt'], 3); assert.equal(S.isOpen(c.shops.ferry), false); }
    if (s.id === 'sell') { assert.ok(r.after < r.before, 'the price moves down as the shelf fills'); assert.equal(r.toll, Q.TOLL); }
    if (s.id === 'invest') assert.equal(S.isOpen(c.shops.ferry), true);
  }
  assert.ok(Q.finished(c)); assert.deepEqual(Q.progress(c), { done: 9, total: 9 });
  assert.ok(p.near > 0n, 'kept a first coin'); assert.equal(p.bag['share:ferry'], 1); assert.equal(S.level(p.rep), 2);
  assert.equal(S.player(c, 'porter').near, Q.WAGE);
  assert.ok(Q.nextDay(c)); assert.equal(Q.current(c).shop, 'hall');
});

test('story: proof links point at recorded mainnet transactions', () => {
  for (const s of Q.STEPS.filter((x) => x.proof)) assert.match(s.proof.url, /^https:\/\/nearblocks\.io\/txns\/[1-9A-HJ-NP-Za-km-z]{43,44}$/);
});
