// The anchors and rule versions an account wrote, rebuilt from its own transactions.
// The board stores neither, so these two are the durable index: same inputs, same output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuildAccount, anchorsIn, rulesWritesIn, argsOf, orderWrites } from '../../src/chronicle-index.js';
import { reconstructRules, rulesVersionAt, rulesSnapshot, rulesCanon, rowsWithoutRules, RULES_METHODS } from '../../../shared/chronicle/rules.js';
import { sha256Hex } from '../../../app/src/chronicle-audit.js';
import { MAINNET_DEP } from '../../src/config.js';

const BOARD = MAINNET_DEP?.board?.contract || 'board.nearcarta.near';
const HASH = '8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR';
const OWNER = 'alice.near';

const b64 = s => Buffer.from(JSON.stringify(s)).toString('base64');
const ts = (iso) => String(BigInt(Date.parse(iso)) * 1_000_000n);

function txWith({ hash = HASH, at = '2026-11-06T10:00:00.000Z', calls = [], logs = [], executor = BOARD, failed = false } = {}) {
  return {
    transaction: { hash, signer_id: OWNER, receiver_id: BOARD },
    transaction_outcome: { block_timestamp: ts(at) },
    receipts: calls.map(c => ({ receiver_id: c.receiver || BOARD, receipt: { Action: { actions: [{ FunctionCall: { method_name: c.method, args: b64(c.args || {}) } }] } } })),
    receipts_outcome: logs.length ? [{ id: 'r1', outcome: { executor_id: executor, status: failed ? { Failure: {} } : { SuccessValue: '' }, logs } }] : [],
  };
}

const anchorLog = (owner, commitment, { nonce = '0', time = '2026-11-06T10:00:00.000Z', kind = 'statement' } = {}) =>
  'EVENT_JSON:' + JSON.stringify({ standard: 'nearcarta-board', version: '2', event: 'anchor', owner, kind, commitment, nonce, time: ts(time) });

test('a receipt call decodes to its args, and a broken body is null rather than a throw', () => {
  const ok = argsOf({ FunctionCall: { args: b64({ kind: 'statement', digest: 'ab' }) } });
  assert.deepEqual(ok, { kind: 'statement', digest: 'ab' });
  assert.equal(argsOf({ FunctionCall: { args: Buffer.from('not json').toString('base64') } }), null);
  assert.equal(argsOf({ FunctionCall: { args: Buffer.from('[1,2]').toString('base64') } }), null);
  assert.equal(argsOf({ Transfer: { deposit: '1' } }), null);
});

test('only row-writing methods on the board count as rule writes', () => {
  const tx = txWith({ calls: [
    { method: 'set_rules', args: { receivers: ['b.near'] } },
    { method: 'set_calls', args: { rules: [] } },
    { method: 'propose', args: { amount: '1' } },
    { method: 'anchor', args: { kind: 'statement' } },
  ] });
  const writes = rulesWritesIn(tx, { board: BOARD });
  assert.deepEqual(writes.map(w => w.method), ['set_rules', 'set_calls']);
  assert.ok(RULES_METHODS.includes('open_charter'));
  assert.ok(!RULES_METHODS.includes('anchor'), 'an anchor does not change the rules');
  // A call to another contract is not this row's rules.
  const other = txWith({ calls: [{ method: 'set_rules', receiver: 'townhall.nearcarta.near' }] });
  assert.deepEqual(rulesWritesIn(other, { board: BOARD }), []);
});

test('an anchor log on a successful receipt is read and a failed receipt is not', () => {
  const commitment = 'ab'.repeat(32);
  const good = txWith({ logs: [anchorLog(OWNER, commitment, { nonce: '4' })] });
  const got = anchorsIn(good, { board: BOARD });
  assert.equal(got.length, 1);
  assert.equal(got[0].commitment, commitment);
  assert.equal(got[0].nonce, '4');
  assert.equal(anchorsIn(txWith({ logs: [anchorLog(OWNER, commitment)], failed: true }), { board: BOARD }).length, 0, 'a rolled-back log is not an anchor');
  assert.equal(anchorsIn(txWith({ logs: [anchorLog(OWNER, commitment)] }), { board: BOARD }).length, 1);
  // Another visitor's event in the same receipt is not this account's anchor.
  assert.equal(anchorsIn(txWith({ logs: [anchorLog('bob.near', commitment)] }), { board: BOARD, owner: OWNER }).length, 0);
});

test('the rebuild lists this account anchors newest last, with the tx and the chain time', () => {
  const c1 = '11'.repeat(32), c2 = '22'.repeat(32);
  const txs = [
    txWith({ hash: HASH, at: '2026-11-06T11:00:00.000Z', logs: [anchorLog(OWNER, c2, { nonce: '5', time: '2026-11-06T11:00:00.000Z' })] }),
    txWith({ hash: 'A'.repeat(44), at: '2026-11-06T10:00:00.000Z', logs: [anchorLog(OWNER, c1, { nonce: '3', time: '2026-11-06T10:00:00.000Z' })] }),
  ];
  const body = rebuildAccount({ account: OWNER, board: BOARD, txs });
  assert.deepEqual(body.anchors.map(a => a.commitment), [c1, c2]);
  assert.deepEqual(body.anchors.map(a => a.tx), ['A'.repeat(44), HASH]);
  assert.deepEqual(body.anchors.map(a => a.nonce), ['3', '5']);
  assert.equal(body.anchors[0].owner, OWNER);
  assert.equal(body.signed, false, 'a rebuild never claims a signature');
  assert.equal(body.board, BOARD);
  // Rebuilding twice gives the same bytes: this is what makes the index replayable.
  assert.deepEqual(rebuildAccount({ account: OWNER, board: BOARD, txs }).anchors, body.anchors);
});

test('rule writes are ordered oldest first so the last one is the live row', () => {
  const txs = [
    txWith({ hash: 'B'.repeat(44), at: '2026-11-06T12:00:00.000Z', calls: [{ method: 'set_rules', args: { receivers: ['c.near'] } }] }),
    txWith({ hash: 'C'.repeat(44), at: '2026-11-06T09:00:00.000Z', calls: [{ method: 'open_charter', args: { agent: 'ed25519:x' } }] }),
  ];
  const body = rebuildAccount({ account: OWNER, board: BOARD, txs });
  assert.deepEqual(body.ruleWrites.map(w => w.method), ['open_charter', 'set_rules']);
  const ordered = orderWrites([{ at: '2026-11-06T12:00:00.000Z' }, { at: '2026-11-06T09:00:00.000Z' }]);
  assert.deepEqual(ordered.map(x => x.at), ['2026-11-06T09:00:00.000Z', '2026-11-06T12:00:00.000Z']);
});

test('a rules version is a stable id over the row fields that decide a payment', () => {
  const row = {
    owner: OWNER, receivers: ['b.near', 'a.near'], per_action_cap: '1000', daily_budget: '5000',
    max_actions_per_day: 4, min_amount: '1', window_start_min: 0, window_end_min: 0, expires_at: '0',
    frozen: false, sealed: false, agent: 'ed25519:aa', nonce: 3, balance: '9',
  };
  const snap = rulesSnapshot(row);
  assert.deepEqual(snap.receivers, ['b.near', 'a.near']);
  // Order in the array does not change the version: the same rule set has one id.
  const reordered = rulesSnapshot({ ...row, receivers: ['a.near', 'b.near'] });
  assert.equal(rulesCanon(snap), rulesCanon(reordered));
  // Changing a field that decides a payment changes the version.
  assert.notEqual(rulesCanon(snap), rulesCanon(rulesSnapshot({ ...row, per_action_cap: '2000' })));
  assert.notEqual(rulesCanon(snap), rulesCanon(rulesSnapshot({ ...row, frozen: true })));
  // Fields that do not decide a payment are not in the version.
  assert.equal(rulesCanon(snap), rulesCanon(rulesSnapshot({ ...row, balance: '123', nonce: 40, agent: 'ed25519:bb' })));
});

test('reconstructing rules gives one version per write, and names the live row when no write is readable', () => {
  const row = { owner: OWNER, receivers: ['shop.near'], per_action_cap: '1000', daily_budget: '5000', max_actions_per_day: 2, min_amount: '1', window_start_min: 0, window_end_min: 0, expires_at: '0', frozen: false, sealed: false };
  const writes = [
    { hash: 'C'.repeat(44), method: 'open_charter', at: '2026-11-06T09:00:00.000Z', rowAfter: { ...row, per_action_cap: '400' } },
    { hash: 'B'.repeat(44), method: 'set_rules', at: '2026-11-06T12:00:00.000Z', rowAfter: row },
  ];
  const built = reconstructRules({ row, writes, hashHex: sha256Hex, owner: OWNER });
  assert.equal(built.versions.length, 2);
  assert.equal(built.versions[0].method, 'open_charter');
  assert.match(built.versions[0].version, /^[0-9a-f]{12}$/);
  assert.notEqual(built.versions[0].version, built.versions[1].version, 'a changed cap is a new version');
  assert.equal(built.current.version, built.versions[1].version);
  assert.equal(built.why, '');
  // A payment at 10:00 ran under the first version; one at 13:00 under the second.
  assert.equal(rulesVersionAt(built.versions, '2026-11-06T10:00:00.000Z'), built.versions[0].version);
  assert.equal(rulesVersionAt(built.versions, '2026-11-06T13:00:00.000Z'), built.versions[1].version);
  // With no write readable, the live row is still a rule set, labelled as undated.
  const onlyRow = reconstructRules({ row, writes: [], hashHex: sha256Hex, owner: OWNER });
  assert.equal(onlyRow.versions.length, 1);
  assert.equal(onlyRow.versions[0].method, 'current-row');
  assert.match(onlyRow.why, /no dates/);
  // With neither, there is no version and the caller is told so.
  const none = reconstructRules({ row: null, writes: [], hashHex: sha256Hex });
  assert.equal(none.versions.length, 0);
  assert.match(none.why, /No rules were readable/);
  assert.equal(rulesVersionAt([], '2026-11-06T10:00:00.000Z'), '', 'no version is invented');
});

test('rows older than the first readable rule version are counted as unknown', () => {
  const versions = [{ version: 'abc', tx: 'C'.repeat(44), at: '2026-11-06T09:00:00.000Z' }];
  const rows = [
    { h: 'A', at: '2026-11-06T08:00:00.000Z' },
    { h: 'B', at: '2026-11-06T10:00:00.000Z' },
  ];
  const out = rowsWithoutRules(versions, rows);
  assert.equal(out.missing, 1);
  assert.equal(out.firstKnown, '2026-11-06T09:00:00.000Z');
  assert.deepEqual(rowsWithoutRules([], rows), { missing: 2, firstKnown: '' });
});
