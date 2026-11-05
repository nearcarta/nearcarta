import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, decide, lookalikeOf, DENY } from '../../src/counterparty.js';
import { lookalike, invoicePayee } from '../../../shared/vault/attacks.js';

const NOW = Date.parse('2026-10-28T20:00:00Z');
const ns = ms => String(BigInt(ms) * 1_000_000n);
const ALLOW = ['bakery.shop.near', 'cafe.shop.near'];
const charterView = (actions = []) => async (acct, method, args) => {
  if (method === 'get_clauses') return { pay: { receivers: ALLOW } };
  if (method === 'get_state') return { next_action: String(actions.length), prune_cursor: '0' };
  if (method === 'get_action') return actions[Number(args.action_id)] || null;
  throw new Error('unexpected ' + method);
};
const missing = async () => { throw new Error('rpc query: UNKNOWN_ACCOUNT {}'); };
const plain = async () => ({ code_hash: '11111111111111111111111111111111' });
const firstTx = ageMs => async path => path === '/account' ? { account_txs: [{ transaction_hash: 'T1', tx_block_timestamp: ns(NOW - ageMs) }], txs_count: 1 } : { transactions: [] };
const DAY = 86_400_000;

test('a missing account is blocked', async () => {
  const r = await check('refund-desk.near', { now: NOW, viewAccount: missing, view: charterView(), fpost: firstTx(DAY), charter: 'c.near' });
  assert.equal(r.verdict, 'block'); assert.ok(r.reasons.some(x => x.code === 'account_missing'));
});
test('every deny-list entry carries tx evidence and is blocked', async () => {
  assert.ok(DENY.entries.length > 0);
  for (const e of DENY.entries) {
    assert.ok(e.evidence.length && e.evidence.every(h => /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h)), e.account);
    const r = await check(e.account, { now: NOW, viewAccount: plain, view: charterView(), fpost: firstTx(30 * DAY), charter: 'c.near' });
    assert.equal(r.verdict, 'block'); assert.deepEqual(r.reasons.find(x => x.code === 'denylisted').evidence, e.evidence);
  }
});
test('the arena look-alike and fake-invoice payees are caught as look-alikes', () => {
  for (const a of ALLOW) {
    assert.equal(lookalikeOf(lookalike(a), ALLOW), a);
    assert.equal(lookalikeOf(invoicePayee(a), ALLOW), a);
    assert.equal(lookalikeOf(a, ALLOW), null);
  }
  assert.equal(lookalikeOf('stranger.near', ALLOW), null);
});
test('an allowed payee paid before is allowed, even if new', async () => {
  const r = await check('bakery.shop.near', { now: NOW, viewAccount: plain, view: charterView([{ receiver: 'bakery.shop.near', status: 'confirmed' }]), fpost: firstTx(3_600_000), charter: 'c.near' });
  assert.equal(r.verdict, 'allow', JSON.stringify(r.reasons)); assert.equal(r.signals.prior_payments, 1);
});
test('a stranger with no history is a warn (ask the human), and a new one says its age', async () => {
  const old = await check('stranger.near', { now: NOW, viewAccount: plain, view: charterView(), fpost: firstTx(30 * DAY), charter: 'c.near' });
  assert.equal(old.verdict, 'warn'); assert.deepEqual(old.reasons.map(x => x.code), ['no_history']);
  const young = await check('stranger.near', { now: NOW, viewAccount: plain, view: charterView(), fpost: firstTx(2 * 3_600_000), charter: 'c.near' });
  assert.deepEqual(young.reasons.map(x => x.code), ['new_account', 'no_history']);
});
test('a contract whose code changed in the last day is flagged with the deploy tx', async () => {
  const fpost = async path => path === '/account'
    ? { account_txs: [{ transaction_hash: 'D1', tx_block_timestamp: ns(NOW - 3_600_000) }, { transaction_hash: 'T0', tx_block_timestamp: ns(NOW - 40 * DAY) }], txs_count: 2 }
    : { transactions: [{ transaction: { hash: 'D1' }, receipts: [{ receipt: { receiver_id: 'cafe.shop.near', receipt: { Action: { actions: [{ DeployContract: {} }] } } }, execution_outcome: { block_timestamp: ns(NOW - 3_600_000) } }] }] };
  const r = await check('cafe.shop.near', { now: NOW, viewAccount: async () => ({ code_hash: 'Abc' }), view: charterView([{ receiver: 'cafe.shop.near', status: 'confirmed' }]), fpost, charter: 'c.near' });
  assert.equal(r.verdict, 'warn'); const c = r.reasons.find(x => x.code === 'code_changed'); assert.deepEqual(c.evidence, ['D1']);
});
test('index outage degrades to the on-chain signals, never to allow-by-error', async () => {
  const r = await check('stranger.near', { now: NOW, viewAccount: plain, view: charterView(), fpost: async () => { throw new Error('fastnear tx http 429'); }, charter: 'c.near' });
  assert.match(r.signals.index, /unavailable/); assert.equal(r.verdict, 'warn');
});
test('decide: block wins over warn', () => {
  assert.equal(decide({ exists: true, deny: { reason: 'x', evidence: [] }, allowlisted: false, prior_payments: 0 }).verdict, 'block');
});
