import test from 'node:test';
import assert from 'node:assert/strict';
import { overLimit } from '../../../shared/townhall/reputation.js';

const H = 3600n * 10n ** 9n, t0 = 1_800_000_000_000n * 10n ** 6n;
const P = (id, proposer, h, status = 'Rejected') => ({ id, proposer, status, submission_time: String(t0 + BigInt(h) * H), votes: {} });

test('overLimit: a newcomer second proposal inside 24 h is marked, the next day is not', () => {
  const ps = [P(1, 'g.testnet', 0), P(2, 'g.testnet', 2), P(3, 'g.testnet', 30)];
  assert.deepEqual([...overLimit(ps)], [2]);
});
test('overLimit: a newcomer with one open proposal may not file another', () => {
  const ps = [P(1, 'g.testnet', 0, 'InProgress'), P(2, 'g.testnet', 30)];
  assert.deepEqual([...overLimit(ps)], [2]);
});
test('overLimit: a listed resident may file 3 a day', () => {
  const ps = [1, 2, 3, 4].map(i => P(i, 'r.testnet', i));
  assert.deepEqual([...overLimit(ps, ['r.testnet'])], [4]);
});
