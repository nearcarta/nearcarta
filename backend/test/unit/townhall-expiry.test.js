import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proposalState, stateText, endsAtMs } from '../../../shared/townhall/expiry.js';
import { townhallProposal } from '../../src/shops.js';

const HOUR_NS = String(3600n * 10n ** 9n);
// proposal #10 as read from r7thmvr8maey.sputnikv2.near: still InProgress on chain, filed at this submission_time
const P10 = { id: 10, proposer: 'ncguest-296t703o3g.near', status: 'InProgress', submission_time: '1793229633097671297', kind: { FunctionCall: {} }, description: 'join' };
const filedMs = Number(BigInt(P10.submission_time) / 1_000_000n);

test('an InProgress proposal past its 1 h window is Expired', () => {
  const s = proposalState(P10, HOUR_NS, filedMs + 3600_000 + 1);
  assert.deepEqual(s, { status: 'Expired', chain_status: 'InProgress', expired: true, ends_at_ms: filedMs + 3600_000 });
  assert.match(stateText(s, filedMs + 3 * 3600_000), /^Expired 2 h ago$/);
});

test('inside the window it stays open, and the window end is exact', () => {
  assert.equal(endsAtMs(P10, HOUR_NS), filedMs + 3600_000);
  const s = proposalState(P10, HOUR_NS, filedMs + 3600_000 - 1);
  assert.equal(s.status, 'InProgress'); assert.equal(s.expired, false);
  assert.equal(stateText(s, filedMs + 25 * 60_000), 'Open, 35 min left');
  // the boundary itself is closed: Sputnik refuses votes once now >= submission_time + period
  assert.equal(proposalState(P10, HOUR_NS, filedMs + 3600_000).expired, true);
});

test('decided proposals keep their status however old they are', () => {
  for (const st of ['Approved', 'Rejected', 'Removed', 'Failed']) {
    const s = proposalState({ ...P10, status: st }, HOUR_NS, filedMs + 10 * 86400_000);
    assert.equal(s.status, st); assert.equal(s.expired, false);
  }
  assert.equal(proposalState({ ...P10, status: 'Expired' }, HOUR_NS, filedMs).expired, true);
});

test('missing submission_time or period never claims expiry', () => {
  assert.equal(proposalState({ status: 'InProgress' }, HOUR_NS).expired, false);
  assert.equal(proposalState(P10, null).expired, false);
  assert.equal(stateText(proposalState({ status: 'InProgress' }, null)), 'Open');
});

test('/api/townhall proposal rows carry the shown status, the chain status and the window end', () => {
  const r = townhallProposal(P10, HOUR_NS, filedMs + 2 * 3600_000);
  assert.equal(r.status, 'Expired'); assert.equal(r.chain_status, 'InProgress'); assert.equal(r.expired, true);
  assert.equal(r.ends_at, new Date(filedMs + 3600_000).toISOString()); assert.equal(r.kind, 'FunctionCall');
  assert.equal(townhallProposal({ ...P10, kind: 'Vote' }, HOUR_NS, filedMs).status, 'InProgress');
  assert.equal(townhallProposal({ ...P10, kind: 'Vote' }, HOUR_NS, filedMs).kind, 'Vote');
});

test('the Town Hall page changes the visitor row and does not file a council proposal', () => {
  const page = readFileSync(new URL('../../../app/shops/hall/main.js', import.meta.url), 'utf8');
  assert.match(page, /set_rules|callsFor/);
  assert.doesNotMatch(page, /add_proposal|sputnik|proposalState/);
  const room = readFileSync(new URL('../../../app/design/D8_shops/shops/hall.js', import.meta.url), 'utf8');
  assert.match(room, /Recorded payments/);
  assert.doesNotMatch(room, /\/api\/townhall/);
  const line = 'This payment is a charter check on mainnet.';
  assert.ok(readFileSync(new URL('../../../app/design/D8_shops/shops/bank.js', import.meta.url), 'utf8').includes(line));
  const ui = readFileSync(new URL('../../../app/design/D8_shops/js/shopui.js', import.meta.url), 'utf8');
  assert.ok(ui.includes(line));
  assert.match(ui, /hall: \['Recorded payments', hallRows\]/);
});
