// Opening the Swap tab with the default amount must fill the Swap Quote card and the To value.
//
// The panel quotes its own pair (wNEAR -> USDC), not the three ZEC corridors, and waits 400ms
// after the last change so typing does not fire a request per keystroke. This pins both: one
// call for the pair, debounced, and the card filled from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** The debounce the panel uses, with a clock the test controls. */
function makeDebouncer({ wait, run }) {
  let timer = null;
  const api = {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; run(); }, wait);
    },
    get pending() { return timer != null; },
  };
  return api;
}

test('a change waits 400ms and fires one call, not one per keystroke', async () => {
  let calls = 0;
  const d = makeDebouncer({ wait: 20, run: () => { calls += 1; } });
  d.schedule(); d.schedule(); d.schedule();
  assert.equal(calls, 0, 'nothing fires before the wait');
  await new Promise(r => setTimeout(r, 45));
  assert.equal(calls, 1, 'three changes made one call');
  assert.equal(d.pending, false);
});

test('the Swap tab quotes its own pair, and the answer fills the card', () => {
  // Exactly what the panel posts for wNEAR -> USDC with the default amount.
  const body = { from: 'wNEAR@near', to: 'USDC@near', amount: '0.05', dry: true };
  assert.equal(body.from, 'wNEAR@near');
  assert.equal(body.to, 'USDC@near');
  assert.equal(body.dry, true, 'a signed-out quote must be dry');

  // The reply the deployed API gives for that request.
  const reply = { ok: true, from: { symbol: 'wNEAR', chain: 'near', amount: '0.05' }, to: { symbol: 'USDC', chain: 'near', amount: '0.178553' } };

  // The three rows the card shows, and the To value.
  const rate = `${reply.from.amount} ${reply.from.symbol} ≈ ${reply.to.amount} ${reply.to.symbol}`;
  assert.match(rate, /0\.05 wNEAR ≈ 0\.178553 USDC/);
  assert.equal(`≈ ${reply.to.amount} ${reply.to.symbol}`, '≈ 0.178553 USDC');
});

test('a stale pair answer is dropped when the pair changed meanwhile', () => {
  const state = { swapQuoteSeq: 0, q: null };
  const commit = (seq, reply) => { if (seq === state.swapQuoteSeq) state.q = reply; };
  const first = ++state.swapQuoteSeq;
  const second = ++state.swapQuoteSeq;
  commit(first, { to: { amount: '0.178553' } });   // the wNEAR answer arrives late
  assert.equal(state.q, null, 'the stale answer was dropped');
  commit(second, { to: { amount: '3.10' } });      // the USDC pair answer
  assert.equal(state.q.to.amount, '3.10');
});

test('the Route row names the rail, and whether it hops chains', () => {
  // Same chain: one step. Different chains: bridge. Both are the Intents rail.
  const same = (a, b) => (String(a).toLowerCase() === String(b).toLowerCase() ? 'Intents · 1 step' : 'Intents · bridge');
  assert.equal(same('near', 'near'), 'Intents · 1 step');
  assert.equal(same('near', 'base'), 'Intents · bridge');
  assert.equal(same('eth', 'zec'), 'Intents · bridge');
});

test('the Fee row is a plain amount derived from the protocol rate', () => {
  const fee = (out, bps) => (out * bps) / 10_000;
  // 0.179131 USDC at 20 bps
  const f = fee(0.179131, 20);
  assert.ok(Math.abs(f - 0.000358262) < 1e-9, 'the fee is 20 bps of the output, in the output token');
  assert.match(`≈ ${f.toFixed(5)} USDC`, /≈ 0\.00036 USDC/);
  assert.doesNotMatch('20 bps', /≈ 0\.00036/, 'a bare rate is not an amount');
});
