import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../../shared/market/sim.js';

const town = () => S.createCity();

test('gather fills the bag once per node every 30 seconds, and a tool doubles it until it wears out', () => {
  const c = town();
  assert.equal(S.gather(c, 'me', 'guard-1'), 1);
  assert.throws(() => S.gather(c, 'me', 'guard-1'), /ERR_TOO_SOON/);
  assert.equal(S.cooldown(c, 'me', 'guard-1'), 30);
  S.gather(c, 'me', 'toll-1');
  S.advance(c, 30); S.gather(c, 'me', 'guard-1');
  S.craft(c, 'me', 'item:tool');
  assert.deepEqual(S.player(c, 'me').bag, { 'item:tool': 1 });
  for (let i = 0; i < S.TOOL_LIFE; i++) { S.advance(c, 30); assert.equal(S.gather(c, 'me', 'guard-1'), 2); }
  assert.equal(S.player(c, 'me').bag['item:tool'], undefined, 'worn out');
  assert.equal(S.player(c, 'me').bag['good:iron'], 2 * S.TOOL_LIFE);
});

test('selling pays from the till and the next unit pays less', () => {
  const c = town();
  for (let i = 0; i < 3; i++) { S.gather(c, 'me', 'guard-1'); S.advance(c, 30); }
  const q1 = BigInt(S.quoteAt(c, 'arena', 'good:iron').sell);
  const got = S.sell(c, 'me', 'arena', 'good:iron', 1);
  assert.equal(got, q1);
  assert.ok(BigInt(S.quoteAt(c, 'arena', 'good:iron').sell) < q1);
  assert.equal(S.player(c, 'me').near, got);
});

test('a round trip through the simulated city never gains', () => {
  const r = S.rng(3);
  for (let trial = 0; trial < 200; trial++) {
    const c = S.createCity({ caps: { playerDay: 10n ** 30n, cityDay: 10n ** 30n } }); const p = S.player(c, 'me'); p.near = 500n * S.MILLI;
    const start = p.near; let held = 0;
    for (let i = 0; i < 30; i++) {
      if (r() < 0.5 || held === 0) { S.buy(c, 'me', 'arena', 'good:herb', 1); held++; } else { S.sell(c, 'me', 'arena', 'good:herb', 1); held--; }
      if (r() < 0.2) S.advance(c, S.HOUR_S);
    }
    while (held) { S.sell(c, 'me', 'arena', 'good:herb', 1); held--; }
    assert.ok(p.near < start, `trial ${trial} gained`);
  }
});

test('a broke shop closes to sales and an investment reopens it with dividends to 110%', () => {
  const c = town(); const s = c.shops.toll; s.till = S.FLOOR + S.MILLI;
  for (let i = 0; i < 2; i++) { S.gather(c, 'me', 'guard-1'); S.advance(c, 30); }
  S.sell(c, 'me', 'toll', 'good:iron', 2);
  assert.equal(S.isOpen(s), false);
  S.gather(c, 'me', 'guard-2');
  assert.throws(() => S.sell(c, 'me', 'toll', 'good:iron', 1), /ERR_SHOP_CLOSED/);
  const inv = S.player(c, 'investor'); inv.near = 20n * S.MILLI;
  S.invest(c, 'investor', 'toll', 10n * S.MILLI);
  assert.equal(S.isOpen(s), true);
  assert.equal(s.owed, 11n * S.MILLI);
  const buyer = S.player(c, 'buyer'); buyer.near = 400n * S.MILLI;
  for (let i = 0; i < 30 && s.owed > 0n; i++) S.buy(c, 'buyer', 'toll', i % 2 ? 'good:iron' : 'good:timber', 1);
  assert.equal(s.owed, 0n);
  const back = S.claim(c, 'investor', 'toll');
  assert.ok(back <= 11n * S.MILLI && back + 10n >= 11n * S.MILLI, String(back));
});

test('orders burn the goods, pay the wage and raise reputation', () => {
  const c = town(); S.player(c, 'clerk').near = 10n * S.MILLI;
  const id = S.postOrder(c, 'clerk', 'good:timber', 2, S.MILLI, 'Planks for the bridge');
  S.gather(c, 'me', 'toll-1'); S.gather(c, 'me', 'toll-2');
  assert.throws(() => S.fillOrder(c, 'clerk', id, 1), /ERR_OWN_ORDER|ERR_BALANCE/);
  assert.equal(S.fillOrder(c, 'me', id, 2), 2n * S.MILLI);
  assert.equal(S.player(c, 'me').rep, 1);
  assert.equal(c.orders.length, 0);
  assert.deepEqual([S.level(0), S.level(3), S.level(9)], [1, 2, 3]);
});

test('the city clock runs a 20-minute day: dawn, market, dusk, night', () => {
  assert.equal(S.cityClock(0).phase, 'dawn');
  assert.equal(S.cityClock(5 * 60).phase, 'market');
  assert.equal(S.cityClock(13 * 60).phase, 'dusk');
  assert.equal(S.cityClock(19 * 60).phase, 'night');
  assert.equal(S.cityClock(20 * 60).day, 2);
});

test('fast-forward replays the same week from a seed, and dark shops come back', () => {
  const a = S.runWeek({ seed: 11 }), b = S.runWeek({ seed: 11 });
  assert.equal(a.rows.length, 168);
  assert.deepEqual(a.rows.at(-1).avg, b.rows.at(-1).avg);
  assert.ok(a.rows.some((r) => r.open < 9) || a.rows.every((r) => r.open === 9));
  assert.ok(a.rows.at(-1).open >= 7, `open at the end: ${a.rows.at(-1).open}`);
  assert.ok(a.city.log.some((e) => e.kind === 'refused'));
});

test('a council vote changes a market rule mid-week, with no code change', () => {
  const w = S.runWeek({ seed: 11 });
  const vote = w.events.find((e) => e.kind === 'rule');
  assert.ok(vote && vote.hour === 84);
  assert.equal(w.city.shops.arena.floor, (S.FLOOR * 7_500n) / 10_000n);
  assert.ok(w.events.some((e) => e.kind === 'refused'));
});

test('the daily caps bound what one player and the whole city can take out', () => {
  const c = S.createCity({ caps: { playerDay: 5n * S.MILLI, cityDay: 5n * S.MILLI } });
  for (let i = 0; i < 6; i++) { S.gather(c, 'a', 'guard-1'); S.gather(c, 'b', 'guard-1'); S.advance(c, 30); }
  assert.throws(() => S.sell(c, 'a', 'arena', 'good:iron', 4), /ERR_PLAYER_DAILY_CAP/);
  S.sell(c, 'a', 'arena', 'good:iron', 1);
  assert.throws(() => S.sell(c, 'b', 'hall', 'good:iron', 3), /ERR_CITY_DAILY_CAP/);
  S.advance(c, 86_400);
  S.sell(c, 'a', 'arena', 'good:iron', 1);
});
