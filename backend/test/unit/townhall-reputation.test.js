import test from 'node:test';
import assert from 'node:assert/strict';
import { reputation, tally, votable, canFile, TIERS } from '../../../shared/townhall/reputation.js';

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

const NS = ms => String(BigInt(ms) * 10n ** 6n);
test('guest proposals are rate-limited by tier: a newcomer gets one a day and one open', () => {
  const now = 10 * 86_400_000;
  assert.equal(canFile('new.testnet', [], [], now).ok, true);
  const one = [{ proposer: 'new.testnet', status: 'Expired', kind: 'Vote', submission_time: NS(now - 3600e3) }];
  const r = canFile('new.testnet', one, [], now); assert.equal(r.ok, false); assert.match(r.reason, /1 proposal a day/);
  const old = [{ proposer: 'new.testnet', status: 'InProgress', kind: 'Vote', submission_time: NS(now - 2 * 86_400_000) }];
  const o = canFile('new.testnet', old, [], now); assert.equal(o.ok, false); assert.match(o.reason, /open proposal/);
  const elder = [...ps.map(p => ({ ...p, submission_time: NS(now - 3 * 86_400_000) })), ...one.map(p => ({ ...p, proposer: 'a.testnet' }))];
  assert.equal(canFile('a.testnet', elder, ['a.testnet'], now).ok, true); // elder: 10 a day
});
test('reputation tiers weight the tally and set the town approval tier', () => {
  const hist = [{ proposer: 'e.testnet', status: 'Approved', kind: 'Vote', votes: {} }, { proposer: 'e.testnet', status: 'Approved', kind: 'Vote', votes: { 'e.testnet': 'Approve' } }];
  const rep = a => reputation(a, hist);
  assert.equal(rep('e.testnet').tier, 'elder');
  const m = { kind: 'Vote', votes: { 'e.testnet': 'Approve', 'n1.testnet': 'Approve', 'n2.testnet': 'Reject' } };
  const t = tally(m, rep); assert.equal(t.yes_w, TIERS.elder.weight + 1); assert.equal(t.no_w, 1); assert.equal(t.approval, 'backed');
  const n = tally({ kind: 'Vote', votes: { 'n1.testnet': 'Approve', 'n2.testnet': 'Approve' } }, rep); assert.equal(n.approval, 'open');
});
