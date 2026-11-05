import test from 'node:test';
import assert from 'node:assert/strict';
import { reputation, tally, votable, canFile, TIERS } from '../../../shared/townhall/reputation.js';

const ps = [
  { proposer: 'a.near', status: 'Approved', kind: 'Vote', votes: { 'b.near': 'Approve' } },
  { proposer: 'a.near', status: 'Rejected', kind: 'Vote', votes: { 'a.near': 'Approve', 'b.near': 'Reject' } },
];
test('reputation comes from filed, approved, votes and the reward list', () => {
  assert.deepEqual(reputation('a.near', ps, ['a.near']), { account: 'a.near', filed: 2, approved: 1, votes: 1, listed: true, score: 5, tier: 'elder' });
  assert.equal(reputation('b.near', ps).tier, 'resident');
  assert.equal(reputation('new.near', ps).tier, 'newcomer');
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

const NS = ms => String(BigInt(ms) * 10n ** 6n);
test('guest proposals are rate-limited by tier: a newcomer gets one a day and one open', () => {
  const now = 10 * 86_400_000;
  assert.equal(canFile('new.near', [], [], now).ok, true);
  const one = [{ proposer: 'new.near', status: 'Expired', kind: 'Vote', submission_time: NS(now - 3600e3) }];
  const r = canFile('new.near', one, [], now); assert.equal(r.ok, false); assert.match(r.reason, /1 proposal a day/);
  const old = [{ proposer: 'new.near', status: 'InProgress', kind: 'Vote', submission_time: NS(now - 2 * 86_400_000) }];
  const o = canFile('new.near', old, [], now); assert.equal(o.ok, false); assert.match(o.reason, /open proposal/);
  const elder = [...ps.map(p => ({ ...p, submission_time: NS(now - 3 * 86_400_000) })), ...one.map(p => ({ ...p, proposer: 'a.near' }))];
  assert.equal(canFile('a.near', elder, ['a.near'], now).ok, true); // elder: 10 a day
});
test('reputation tiers weight the tally and set the town approval tier', () => {
  const hist = [{ proposer: 'e.near', status: 'Approved', kind: 'Vote', votes: {} }, { proposer: 'e.near', status: 'Approved', kind: 'Vote', votes: { 'e.near': 'Approve' } }];
  const rep = a => reputation(a, hist);
  assert.equal(rep('e.near').tier, 'elder');
  const m = { kind: 'Vote', votes: { 'e.near': 'Approve', 'n1.near': 'Approve', 'n2.near': 'Reject' } };
  const t = tally(m, rep); assert.equal(t.yes_w, TIERS.elder.weight + 1); assert.equal(t.no_w, 1); assert.equal(t.approval, 'backed');
  const n = tally({ kind: 'Vote', votes: { 'n1.near': 'Approve', 'n2.near': 'Approve' } }, rep); assert.equal(n.approval, 'open');
});
