// Economy integrity: the market cannot be gamed by moving goods back and forth, and the browser's
// pricing is the contract's pricing. These are the property tests; the golden cases in
// shared/market/pricing-cases.json are pinned on both sides (`js and rust pricing agree on every golden
// case`, `js_and_rust_pricing_agree_on_every_golden_case`).
//
// The invariant, from contracts/market/src/pricing.rs:
//   buy  = base * scarcity(s)   * max(1, demand) * mood
//   sell = base * scarcity(s+1) * min(1, demand) * mood * 0.8
// So any sequence of buys and sells that returns the shelf to where it started leaves the actor with
// less, whatever the demand and mood of each hour: a wash trade cannot make money.
//
// Docs: https://docs.near.org/primitives/dex (the market this mirrors)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quote, scarcityBps, demandBps, moodBps } from '../../../shared/market/pricing.js';

/** A tiny deterministic generator, so a failure is reproducible. Rust uses the same shape. */
function lcg(seed) {
  let s = BigInt(seed);
  return () => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return Number(s >> 33n);
  };
}

const market = (over) => ({
  base: '1000000', stock: 20, target_stock: 20, buys_last_hour: 0, sells_last_hour: 0, till: '10', floor: '1', ...over,
});

test('a round trip never gains, over 4000 random sequences', () => {
  // The same shape as the Rust test `a_round_trip_never_gains_over_random_sequences`: random shelf
  // moves, random demand and mood each step, then closed back to the starting shelf.
  const r = lcg(7);
  const TRIALS = 4000;
  for (let trial = 0; trial < TRIALS; trial++) {
    const target = 1 + (r() % 60);
    const start = r() % 80;
    const base = String(1000 + (r() % 5000000));
    const steps = 1 + (r() % 30);
    let stock = start;
    const moves = [];
    for (let i = 0; i < steps; i++) {
      if (stock > 0 && r() % 2 === 0) { moves.push(true); stock--; } else { moves.push(false); stock++; }
    }
    // Close the loop so the shelf ends where it started.
    while (stock > start) { moves.push(true); stock--; }
    while (stock < start) { moves.push(false); stock++; }
    let paid = 0n;
    let s = start;
    let buys = r() % 30;
    let sells = r() % 30;
    let lowTill = r() % 2 === 0;
    for (const buy of moves) {
      if (r() % 5 === 0) { buys = r() % 30; sells = r() % 30; lowTill = !lowTill; }
      const q = quote(market({ base, stock: s, target_stock: target, buys_last_hour: buys, sells_last_hour: sells, till: lowTill ? '0' : '10' }));
      if (buy) { paid += BigInt(q.buy); s--; } else { paid -= BigInt(q.sell); s++; }
    }
    assert.ok(paid >= 0n, `trial ${trial}: the actor gained ${-paid} yocto`);
  }
});

test('buying one and selling it back loses at least a fifth, at every shelf depth', () => {
  for (let stock = 1; stock < 80; stock++) {
    for (const [buys, sells] of [[0, 0], [40, 0], [0, 40], [7, 3]]) {
      const buy = BigInt(quote(market({ stock, buys_last_hour: buys, sells_last_hour: sells })).buy);
      const back = BigInt(quote(market({ stock: stock - 1, buys_last_hour: buys, sells_last_hour: sells })).sell);
      assert.ok(back * 10n <= buy * 8n + 10n, `stock ${stock}: buy ${buy} back ${back}`);
    }
  }
});

test('a wash trade across two shops cannot gain either', () => {
  // Buy at one shop where the goods are cheap, sell at another where they are dear, then put both
  // shelves back. The two shops share one base price here, which is the friendliest case for the actor.
  const r = lcg(11);
  for (let trial = 0; trial < 800; trial++) {
    const base = String(1000 + (r() % 1000000));
    const aStart = 1 + (r() % 40);
    const bStart = 1 + (r() % 40);
    let shelf = { a: aStart, b: bStart };
    let paid = 0n;
    const moves = [];
    for (let i = 0; i < 10; i++) {
      const cheap = shelf.a <= shelf.b ? 'a' : 'b';
      const dear = cheap === 'a' ? 'b' : 'a';
      moves.push(['buy', cheap]); moves.push(['sell', dear]);
      shelf[cheap]--; shelf[dear]++;
    }
    // Put both shelves back to where they started.
    while (shelf.a > aStart) { moves.push(['buy', 'a']); shelf.a--; }
    while (shelf.a < aStart) { moves.push(['sell', 'a']); shelf.a++; }
    while (shelf.b > bStart) { moves.push(['buy', 'b']); shelf.b--; }
    while (shelf.b < bStart) { moves.push(['sell', 'b']); shelf.b++; }
    shelf = { a: aStart, b: bStart };
    for (const [side, shop] of moves) {
      const q = quote(market({ base, stock: shelf[shop] }));
      if (side === 'buy') { paid += BigInt(q.buy); shelf[shop]--; } else { paid -= BigInt(q.sell); shelf[shop]++; }
    }
    assert.ok(paid >= 0n, `trial ${trial}: a two-shop wash trade gained ${-paid}`);
  }
});

test('the price is monotone in stock and bounded by the clamps', () => {
  for (let stock = 1; stock < 200; stock++) {
    const a = BigInt(quote(market({ stock })).buy);
    const b = BigInt(quote(market({ stock: stock + 1 })).buy);
    assert.ok(a >= b, `a fuller shelf never costs more: ${stock}->${stock + 1} was ${a}->${b}`);
  }
  // The clamps the contract uses, at both ends.
  assert.equal(scarcityBps(0, 20).toString(), '40000', 'an empty shelf is clamped at 4.0, not infinity');
  assert.equal(scarcityBps(10000, 20).toString(), '2500', 'a flooded shelf is clamped at 0.25');
  assert.equal(demandBps(0, 1000).toString(), '5000');
  assert.equal(demandBps(1000, 0).toString(), '20000');
  assert.equal(moodBps('0', '1').toString(), '9000');
  assert.equal(moodBps('5', '1').toString(), '10000');
});

test('a zero-stock shelf still quotes, and the quote never divides by zero', () => {
  const q = quote(market({ stock: 0 }));
  assert.ok(BigInt(q.buy) > 0n);
  assert.ok(BigInt(q.sell) > 0n);
  // A huge target with a tiny shelf is clamped, not multiplied out of range.
  const wild = quote(market({ stock: 1, target_stock: 1_000_000 }));
  assert.equal(scarcityBps(1, 1_000_000).toString(), '40000');
  assert.ok(BigInt(wild.buy) > 0n);
});
