import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planHouseLine, runHouseTurn } from '../../../app/src/panels/house-agent.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const SEC = 1_000_000_000;
const line = over => ({
  heirs: ['heir.near'], guardians: ['g1.near'], threshold: 1,
  last_check_in_ns: String(Date.now() * 1e6 - 120 * SEC), period_ns: String(60 * SEC), wait_ns: String(60 * SEC),
  pending_ns: 0, approvals: [], released: false, epoch: 0, ...over,
});
const ctx = extra => ({ account: 'holder.near', board: 'board.nearcarta.near', house: 'house.nearcarta.near', tokenId: 'holder.near', row: { nonce: '4', epoch: '0', min_amount: '1', per_action_cap: '5000000000000000000000', balance: '50000000000000000000000', receivers: ['house.nearcarta.near'] }, ...extra });
// `planHouseLine` reads the line from ctx.line.line and the mint check from ctx.tokenId.
const withLine = (l, extra) => ctx({ line: { live: true, line: l }, ...extra });

test('a release is refused until the guardians met the threshold and the wait ended', () => {
  const notWaiting = planHouseLine('Release the deed', withLine(line()));
  assert.equal(notWaiting.label, 'blocked');
  assert.match(notWaiting.hint, /No release is waiting/);

  const stillWaiting = planHouseLine('Release the deed', withLine(line({ pending_ns: Date.now() * 1e6, wait_ns: String(300 * SEC) })));
  assert.equal(stillWaiting.label, 'blocked');
  assert.match(stillWaiting.hint, /waiting period has \d+s left/);

  const noThreshold = planHouseLine('Release the deed', withLine(line({ pending_ns: String(Date.now() * 1e6 - 120 * SEC), wait_ns: String(60 * SEC), threshold: 2, approvals: ['g1.near'] })));
  assert.equal(noThreshold.label, 'blocked');
  assert.match(noThreshold.hint, /Not enough guardians/);

  // A release needs the threshold met; this line has no approvals, so it is correctly blocked.
  const noApprovals = planHouseLine('Release the deed', withLine(line({ pending_ns: String(Date.now() * 1e6 - 120 * SEC) })));
  assert.equal(noApprovals.label, 'blocked');
  assert.match(noApprovals.hint, /Not enough guardians/);

  // With the threshold met and the wait over, it is ready.
  const ready = planHouseLine('Release the deed', withLine(line({ pending_ns: String(Date.now() * 1e6 - 120 * SEC), approvals: ['g1.near'] })));
  assert.equal(ready.label, 'planned');
  assert.equal(ready.method, 'house_release');
});

test('cancel stops a waiting release and is the holder\'s own key', () => {
  const none = planHouseLine('Cancel the release', withLine(line()));
  assert.equal(none.label, 'blocked');
  const waiting = planHouseLine('Cancel the release', withLine(line({ pending_ns: '123' })));
  assert.equal(waiting.label, 'planned');
  assert.equal(waiting.method, 'house_cancel_release');
  assert.equal(waiting.oneYocto, true);
  assert.match(waiting.hint, /holder's own key/);
});

test('a guardian approves after the window, with their own key', () => {
  const p = planHouseLine('Approve the release', ctx());
  assert.equal(p.method, 'house_guardian_approve');
  assert.equal(p.oneYocto, true);
  const out = planHouseLine('Approve the release', {});
  assert.equal(out.label, 'simulation');
});

test('set-line is a session write and needs an heir and a guardian', () => {
  const miss = planHouseLine('Set heirs', ctx({ params: {} }));
  assert.equal(miss.label, 'simulation');
  assert.match(miss.hint, /Name one heir and one guardian/);
  const ok = planHouseLine('Set heirs', ctx({ params: { heirs: ['heir.near'], guardians: ['g1.near'], threshold: 1, periodNs: 60000000000, waitNs: 60000000000 } }));
  assert.equal(ok.label, 'planned');
  assert.equal(ok.write, 'setline');
  assert.deepEqual(ok.line.heirs, ['heir.near']);
});

test('mint is offered only while the account holds no deed', () => {
  // ctx() names a token id, which is the "already holds a deed" case.
  const already = planHouseLine('Mint my deed', ctx());
  assert.equal(already.label, 'blocked');
  assert.match(already.hint, /already has a deed/);
  const p = planHouseLine('Mint my deed', ctx({ tokenId: '' }));
  assert.equal(p.label, 'planned');
  assert.equal(p.write, 'mint');
});

test('a holder-only plan runs through the approval path, and a session write through the executor', async () => {
  const calls = [];
  const sent = await runHouseTurn('Cancel the release', {
    ...withLine(line({ pending_ns: '123' })),
    holderSign: async (method, args) => { calls.push(['holder', method, args]); return { ok: true, tx: 'TX1' }; },
    sign: async () => { calls.push(['session']); return { ok: true, tx: 'TX2' }; },
  });
  assert.equal(sent.label, 'live');
  assert.equal(sent.tx, 'TX1');
  assert.equal(sent.signer, 'holder');
  assert.deepEqual(calls[0], ['holder', 'house_cancel_release', { token_id: 'holder.near' }]);

  const checkin = await runHouseTurn("I'm alive", {
    ...withLine(line({ pending_ns: '123', approvals: ['g1.near'] })),
    sign: async (build, kind) => { calls.push(['session', build.method, kind]); return { ok: true, tx: 'TX3' }; },
  });
  assert.equal(checkin.label, 'live');
  assert.equal(checkin.tx, 'TX3');
  assert.deepEqual(calls.at(-1), ['session', 'propose_call_as', 'checkin']);
});

test('a refused approval does not claim a landed tx', async () => {
  const out = await runHouseTurn('Cancel the release', {
    ...withLine(line({ pending_ns: '123' })),
    holderSign: async () => ({ ok: false, reason: 'The wallet did not approve this. Nothing was signed.' }),
  });
  assert.equal(out.label, 'refused');
  assert.equal(out.signed, false);
  assert.notEqual(out.tx, 'live');
});

test('the heirs pane is editable and shows the epoch and a real countdown', () => {
  const room = read('app/src/panels/house-room.js');
  assert.match(room, /id="house-heir" data-testid="house-heir" placeholder=/);
  assert.doesNotMatch(room, /id="house-heir"[^>]*readonly/);
  assert.match(room, /house-epoch/);
  assert.match(room, /Release in \$\{Math\.ceil/);
  assert.match(room, /Check-in window \$\{Math\.ceil/);
});
