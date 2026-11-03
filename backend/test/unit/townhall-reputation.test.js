import test from 'node:test';
import assert from 'node:assert/strict';
import { reputation, tally, votable } from '../../../shared/townhall/reputation.js';

const ps = [
  { proposer: 'a.testnet', status: 'Approved', kind: 'Vote', votes: { 'b.testnet': 'Approve' } },
  { proposer: 'a.testnet', status: 'Rejected', kind: 'Vote', votes: { 'a.testnet': 'Approve', 'b.testnet': 'Reject' } },
];
test('reputation comes from filed, approved, votes and the reward list', () => {
  assert.deepEqual(reputation('a.testnet', ps, ['a.testnet']), { account: 'a.testnet', filed: 2, approved: 1, votes: 1, listed: true, score: 5, tier: 'elder' });
  assert.equal(reputation('b.testnet', ps).tier, 'resident');
  assert.equal(reputation('new.testnet', ps).tier, 'newcomer');
});
test('tally counts yes and no with tiers', () => {
  const t = tally(ps[1], a => reputation(a, ps));
  assert.equal(t.yes, 1); assert.equal(t.no, 1); assert.equal(t.voters.length, 2);
});
test('only open Vote motions inside the window are votable', () => {
  const p = { kind: 'Vote', status: 'InProgress', submission_time: String(1000n * 10n ** 6n) };
  assert.equal(votable(p, String(3600n * 10n ** 9n), 2000), true);
  assert.equal(votable(p, String(10n ** 6n), 5000), false);
  assert.equal(votable({ ...p, kind: { FunctionCall: {} } }, String(3600n * 10n ** 9n), 2000), false);
});
