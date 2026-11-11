// The nearblocks v3 adapter. Testnet retired v1 (410 on 2026-11-05), so both networks go through one
// shape. The fixture is a real v3 response body from api-testnet.nearblocks.io, shortened to two rows.
// Docs: https://api-testnet.nearblocks.io/api-docs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rowsOf, cursorOf, v3ToV1, txRange, ftRange, accountTxPath, accountFtPath } from '../../../shared/net/nearblocks.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/nearblocks-v3-txns.json', import.meta.url), 'utf8'));

test('nearblocks v3: a recorded testnet page is read as v1 rows', () => {
  assert.equal(rowsOf(fixture).length, 2);
  assert.ok(cursorOf(fixture), 'v3 pages with meta.next_page');
  const rows = txRange(fixture);
  assert.equal(rows.length, 2);
  const [first] = rows;
  assert.equal(first.transaction_hash, fixture.data[0].transaction_hash);
  assert.equal(first.block_timestamp, fixture.data[0].block_timestamp);
  assert.equal(first.signer_account_id, 'tx-bench.testnet');
  assert.equal(first.receiver_account_id, 'wrap.testnet');
  // v3 names no predecessor; the signer is the only sender it reports.
  assert.equal(first.predecessor_account_id, 'tx-bench.testnet');
  assert.deepEqual(first.actions.map((a) => [a.action, a.method]), [['FUNCTION_CALL', 'near_deposit'], ['FUNCTION_CALL', 'ft_transfer_call']]);
  assert.equal(first.receipt_outcome.status, true);
});

test('nearblocks v3: a v1 body still reads exactly as before', () => {
  const v1 = {
    txns: [{ transaction_hash: 'Hx1', block_timestamp: '1794274435495598517', predecessor_account_id: 'alice.near', receiver_account_id: 'arena.near', receipt_outcome: { status: false }, actions: [{ action: 'FUNCTION_CALL', method: 'sell', args: '{"qty":3}' }] }],
    cursor: 'C1',
  };
  assert.equal(rowsOf(v1).length, 1);
  assert.equal(cursorOf(v1), 'C1');
  const [row] = txRange(v1);
  assert.equal(row.transaction_hash, 'Hx1');
  assert.equal(row.predecessor_account_id, 'alice.near', 'a v1 predecessor is kept, not overwritten by the signer');
  assert.equal(row.receipt_outcome.status, false);
  assert.equal(row.actions[0].args, '{"qty":3}');
});

test('nearblocks v3: a failed receipt stays failed, and unusable rows are dropped', () => {
  const body = { data: [
    { transaction_hash: 'H1', signer_account_id: 'a.testnet', receiver_account_id: 'b.testnet', outcomes: { status: false }, actions: [{ action: 'FUNCTION_CALL', method: 'cross' }] },
    { signer_account_id: 'no-hash.testnet', actions: [] },
    null,
  ] };
  const rows = txRange(body);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].receipt_outcome.status, false, 'the timeline marks a refused step as refused');
});

test('nearblocks v3: an FT row is mapped to the v1 fields the timeline reads', () => {
  const body = { data: [{ transaction_hash: 'H2', block_timestamp: '1794429219373214613', delta_amount: '100000000', contract_account_id: 'tusdc.nearcarta.testnet', involved_account_id: 'alice.play.nearcarta.testnet', affected_account_id: 'keeper-payouts.nearcarta.testnet', meta: { symbol: 'tUSDC', decimals: 6 }, outcomes: { status: true } }] };
  const [ft] = ftRange(body);
  assert.equal(ft.ft.symbol, 'tUSDC');
  assert.equal(ft.ft.decimals, 6);
  assert.equal(ft.ft.contract, 'tusdc.nearcarta.testnet');
  assert.equal(ft.delta_amount, '100000000');
  assert.equal(ft.outcomes.status, true);
  // A v1 FT row passes through untouched.
  const v1 = { txns: [{ transaction_hash: 'H3', ft: { symbol: 'USDC', decimals: 6, contract: 'x.near' }, delta_amount: '1' }] };
  assert.equal(ftRange(v1)[0].ft.contract, 'x.near');
});

test('nearblocks: the path names v1 or v3 and the cursor field that version uses', () => {
  assert.equal(accountTxPath('https://api-testnet.nearblocks.io', 'nearcarta.testnet', { v3: true, limit: 25 }),
    'https://api-testnet.nearblocks.io/v3/accounts/nearcarta.testnet/txns?limit=25');
  assert.equal(accountTxPath('https://api.nearblocks.io/', 'arena.nearcarta.near', { limit: 50 }),
    'https://api.nearblocks.io/v1/account/arena.nearcarta.near/txns?per_page=50');
  assert.match(accountTxPath('https://b', 'a.testnet', { v3: true, cursor: 'N1' }), /[?&]next=N1/);
  assert.match(accountTxPath('https://b', 'a.near', { cursor: 'C1' }), /[?&]cursor=C1/);
  assert.equal(accountFtPath('https://api-testnet.nearblocks.io', 'a.testnet', { v3: true }), 'https://api-testnet.nearblocks.io/v3/accounts/a.testnet/ft-txns?limit=25');
});
