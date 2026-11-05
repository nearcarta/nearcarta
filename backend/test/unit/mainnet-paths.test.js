import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../../src/app.js';
import { judgePropose, toYocto, _setFetch, MAX_YOCTO, TOLL_YOCTO, BOARD } from '../../src/board-tx.js';
import { refusalFor, _setRead } from '../../src/board-guard.js';
import { issuePass, readPass, signPass, _setSecret } from '../../src/toll-pass.js';
import { mainnetChronicle, _setFetch as setFeed, _clear } from '../../src/board-chronicle.js';
import { nextCap, boardPayoutPlan, sealText } from '../../../app/design/D8_shops/js/board-plan.js';
import { sealText as sharedSeal } from '../../../shared/board/seal.js';

const VISITOR = 'alice.near';
const PAYEE = 'shop.nearcarta.near';
const TOLL = 'toll.nearcarta.near';
const HASH = '4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia';
const ZEC = 'ab'.repeat(32);
const y001 = TOLL_YOCTO.toString();
const y005 = MAX_YOCTO.toString();

function txFor({ visitor = VISITOR, payee = PAYEE, amount = y001, fail = false, transfer = true } = {}) {
  const args = Buffer.from(JSON.stringify({ owner: visitor, receiver: payee, amount, signature: 'ab'.repeat(64), reveal: null })).toString('base64');
  const receipts = [];
  const receipts_outcome = [];
  if (transfer) {
    receipts.push({ receipt_id: 't1', predecessor_id: BOARD, receiver_id: payee, receipt: { Action: { actions: [{ Transfer: { deposit: amount } }] } } });
    receipts_outcome.push({ id: 't1', outcome: { executor_id: payee, status: { SuccessValue: '' } } });
    receipts.push({ receipt_id: 'p1', predecessor_id: payee, receiver_id: BOARD, receipt: { Action: { actions: [{ FunctionCall: { method_name: 'on_paid', args: '' } }] } } });
    receipts_outcome.push({ id: 'p1', outcome: { executor_id: BOARD, status: fail ? { Failure: {} } : { SuccessValue: '' } } });
  }
  return {
    transaction: { signer_id: visitor, receiver_id: BOARD, actions: [{ FunctionCall: { method_name: 'propose', args } }] },
    status: fail ? { Failure: { ActionError: {} } } : { SuccessValue: '' },
    receipts, receipts_outcome,
  };
}

const zecBody = { txid: ZEC, feeZat: '1000', valueBalanceSaplingZat: '0', valueBalanceOrchardZat: '0', valueBalanceIronwoodZat: '1000', inputs: [], outputs: [], totalInputZat: '0', totalOutputZat: '0' };

test('a board propose matches the visitor, the payee and the transfer', () => {
  const j = judgePropose(txFor(), { visitor: VISITOR, payee: PAYEE, amount: '0.001' });
  assert.equal(j.ok, true);
  assert.equal(j.amount, y001);
  assert.equal(j.on_paid, 'success');
  assert.equal(toYocto('0.005'), MAX_YOCTO);
  assert.equal(judgePropose(txFor({ amount: y005 }), { visitor: VISITOR, payee: PAYEE, amount: y005 }).ok, true);
});

test('a propose over 0.005, the wrong signer, or a missing transfer is refused', () => {
  const over = (6n * 10n ** 21n).toString();
  assert.equal(judgePropose(txFor({ amount: over }), { visitor: VISITOR, payee: PAYEE, amount: over }).reason, 'amount is above 0.005 NEAR');
  assert.match(judgePropose(txFor(), { visitor: 'bob.near', payee: PAYEE, amount: '0.001' }).reason, /signer/);
  assert.match(judgePropose(txFor({ transfer: false }), { visitor: VISITOR, payee: PAYEE, amount: '0.001' }).reason, /transfer/);
  assert.match(judgePropose(txFor({ fail: true }), { visitor: VISITOR, payee: PAYEE, amount: '0.001' }).reason, /failed/);
});

test('POST /api/mistbank/mainnet checks the board propose and the Zcash testnet leg', async () => {
  _setFetch(async () => ({ json: async () => ({ result: txFor() }) }));
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    if (!String(url).includes(ZEC)) throw new Error('unexpected ' + url);
    return { ok: true, status: 200, json: async () => zecBody };
  };
  try {
    const res = await makeApp().request('/api/mistbank/mainnet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visitor: VISITOR, tx: HASH, payee: PAYEE, amount: '0.001', zcash_txid: ZEC }) });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(j.network, { near: 'mainnet', zcash: 'testnet' });
    assert.equal(j.near.ok, true);
    assert.equal(j.near.url, 'https://nearblocks.io/txns/' + HASH);
    assert.equal(j.zcash.amount_hidden, true);
    const bad = await makeApp().request('/api/mistbank/mainnet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visitor: 'bob.near', tx: HASH, payee: PAYEE, amount: '0.001', zcash_txid: ZEC }) });
    assert.equal(bad.status, 422);
  } finally { globalThis.fetch = real; _setFetch(null); }
});

test('the allowlist refusal comes before the sealed-rule refusal', () => {
  const row = { receivers: [PAYEE], sealed: true };
  assert.equal(refusalFor(row, 'stranger.near').reason, 'receiver_not_allowlisted');
  assert.equal(refusalFor(row, PAYEE, [PAYEE]).reason, 'hidden_rule_receiver');
  assert.equal(refusalFor(row, PAYEE).ok, true);
  assert.equal(refusalFor(null, PAYEE).reason, 'no_charter');
});

test('GET /api/guardhouse/board is a view and names the refusal', async () => {
  _setRead(async (board, method, args) => {
    assert.equal(board, BOARD); assert.equal(method, 'get_charter'); assert.equal(args.owner, VISITOR);
    return { receivers: [PAYEE], sealed: true };
  });
  try {
    const res = await makeApp().request('/api/guardhouse/board?visitor=' + VISITOR + '&payee=stranger.near&deny=' + PAYEE);
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.reason, 'receiver_not_allowlisted');
    assert.equal(j.network, 'mainnet');
    const hid = await (await makeApp().request('/api/guardhouse/board?visitor=' + VISITOR + '&payee=' + PAYEE + '&deny=' + PAYEE)).json();
    assert.equal(hid.reason, 'hidden_rule_receiver');
  } finally { _setRead(null); }
});

test('a toll pass is 0.001 NEAR to toll.nearcarta.near and expires', async () => {
  _setSecret('test-secret-test-secret-test-secret');
  _setFetch(async () => ({ json: async () => ({ result: txFor({ payee: TOLL, amount: y001 }) }) }));
  try {
    const pass = await issuePass({ visitor: VISITOR, tx: HASH, now: 1_000 });
    assert.equal(pass.network, 'mainnet');
    assert.equal(pass.payee, TOLL);
    assert.equal(pass.amount, '0.001');
    assert.equal(readPass(pass.pass, 1_000).tx, HASH);
    assert.throws(() => readPass(pass.pass, 1_000 + 11 * 60_000), /expired/);
    const res = await makeApp().request('/api/toll/mainnet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visitor: VISITOR, tx: HASH }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).amount, '0.001');
    assert.throws(() => readPass(signPass({ exp: 1 }), 5), /expired/);
  } finally { _setFetch(null); }
});

test('GET /api/chronicle?net=mainnet lists propose rows and falls back to known hashes', async () => {
  const body = txFor();
  setFeed(async url => {
    if (String(url).includes('nearblocks')) return { ok: true, json: async () => ({ txns: [{ transaction_hash: HASH, receiver_account_id: BOARD, actions: [{ method: 'propose' }], block_timestamp: '1700000000000000000' }] }) };
    return { json: async () => ({ result: body }) };
  });
  _clear();
  try {
    const res = await makeApp().request('/api/chronicle?net=mainnet&owner=' + VISITOR);
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.network, 'mainnet');
    assert.equal(j.txs[0].hash, HASH);
    assert.equal(j.txs[0].url, 'https://nearblocks.io/txns/' + HASH);
    assert.equal(j.txs[0].on_paid, 'success');
    assert.equal(j.entry, 'one propose of 0.001 NEAR');
  } finally { setFeed(null); _clear(); }
  setFeed(async url => {
    if (String(url).includes('nearblocks')) return { ok: false, status: 429, json: async () => ({}) };
    return { json: async () => ({ result: body }) };
  });
  const known = await mainnetChronicle({ owner: VISITOR, known: [HASH] });
  assert.match(known.source, /known tx hashes/);
  assert.equal(known.txs[0].payee, PAYEE);
  setFeed(null); _clear();
});

test('the payout plan stays under 0.005 each and 0.01 together, and the seal text matches', () => {
  const plan = boardPayoutPlan([{ to: PAYEE, amt: '0.001' }, { to: TOLL, amt: '0.002' }], [PAYEE, TOLL]);
  assert.equal(plan.mode, 'one at a time, not all-or-nothing');
  assert.equal(plan.total, 0.003);
  assert.throws(() => boardPayoutPlan([{ to: PAYEE, amt: '0.006' }], [PAYEE]), /0\.005/);
  assert.throws(() => boardPayoutPlan([{ to: 'stranger.near', amt: '0.001' }], [PAYEE]), /receiver_not_allowlisted/);
  assert.throws(() => boardPayoutPlan([{ to: PAYEE, amt: '0.004' }, { to: PAYEE, amt: '0.004' }, { to: PAYEE, amt: '0.004' }], [PAYEE]), /0\.01/);
  const row = { per_action_cap: y001, daily_budget: (10n ** 22n).toString(), min_amount: '1' };
  assert.equal(nextCap(row, 'looser').cap, (BigInt(y001) * 8n / 5n).toString());
  assert.equal(nextCap({ ...row, per_action_cap: y005 }, 'looser').unchanged, true);
  const text = sealText({ contract: BOARD, deny: ['stranger.near'], salt: 'abc123', max: 'none' });
  assert.equal(text, sharedSeal({ contract: BOARD, deny: ['stranger.near'], salt: 'abc123', max: 'none' }));
  assert.match(text, /^oath-hidden-v1\|/);
});
