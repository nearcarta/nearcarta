import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { indexPost, gate, _reset } from '../../src/txindex.js';

const res = (status, body = {}) => ({ ok: status < 300, status, json: async () => body });
beforeEach(_reset);

test('a 429 sets one shared cooldown that other callers wait out', async () => {
  let n = 0; const f = async () => (++n === 1 ? res(429) : res(200, { ok: n }));
  const t0 = Date.now();
  assert.deepEqual(await indexPost('/x', {}, { f, baseMs: 120 }), { ok: 2 });
  assert.ok(Date.now() - t0 >= 100, 'waited the cooldown');
  assert.equal(gate.strikes, 0); // reset by the success
});

test('every request carries a deadline signal; a hung index is a busy error, not a hang', async () => {
  let sig = null;
  const f = (_u, o) => { sig = o.signal; return new Promise((_r, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' })))); };
  const t0 = Date.now();
  const keep = setInterval(() => {}, 100); // a real socket keeps the loop alive; the fake needs a timer
  try { await assert.rejects(indexPost('/x', {}, { f, deadlineMs: 1200, tries: 1, baseMs: 1 }), /busy \(timeout\)/); } finally { clearInterval(keep); }
  assert.ok(sig instanceof AbortSignal);
  assert.ok(Date.now() - t0 < 5000);
});

test('low priority waits while a high request is in flight, then goes', async () => {
  const order = [];
  let release; const held = new Promise(r => (release = r));
  const fHigh = async () => { order.push('high-start'); await held; order.push('high-end'); return res(200, {}); };
  const fLow = async () => { order.push('low'); return res(200, {}); };
  const h = indexPost('/x', {}, { prio: 'high', f: fHigh });
  const l = indexPost('/x', {}, { prio: 'low', f: fLow });
  await new Promise(r => setTimeout(r, 600));
  assert.deepEqual(order, ['high-start']);
  release(); await h; await l;
  assert.deepEqual(order, ['high-start', 'high-end', 'low']);
});

test('low priority gives up when the cooldown outlasts its deadline (the next pass retries)', async () => {
  gate.until = Date.now() + 60_000;
  let n = 0;
  await assert.rejects(indexPost('/x', {}, { prio: 'low', f: async () => { n++; return res(200); }, deadlineMs: 300 }), /busy/);
  assert.equal(n, 0); assert.equal(gate.stats.lowSkipped, 1);
});

test('a 4xx other than 429 is final', async () => {
  let n = 0;
  await assert.rejects(indexPost('/x', {}, { f: async () => { n++; return res(404); }, baseMs: 1 }), e => e.status === 502 && /http 404/.test(e.message));
  assert.equal(n, 1);
});
