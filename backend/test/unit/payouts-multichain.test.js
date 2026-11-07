// Payouts: three-chain payroll and bounded storage sponsorship.
// A foreign row is a real 1Click EXACT_OUTPUT swap paid by the visitor's own session, gated by the
// visitor's own board row. A zero-NEAR issuer is registered from the same session cap, bounded by the
// USDC contract's own storage_balance_bounds.min. Nothing here signs; the sandbox and mainnet proofs
// are run by the owner (see docs/PAYOUTS_LIVE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyPayroll, payrollKey, payrollQuote, payrollFeeUsd, sponsorshipPlan, storageDepositArgs,
  csvReconcile, accountantCsv, USDC_STORAGE_NEAR, USDC_NEAR_CONTRACT,
} from '../../../app/src/panels/payouts-plan.js';
import { parseCsv, splitAssets, receiptsFor, foreignAddressOk } from '../../../app/design/D8_shops/js/payouts.js';
import { payrollRowGate, payrollCheckoutInput, payrollRowStatus, openPayrollCheckout, payrollRowId, resetPayrollRows } from '../../src/payouts-payroll.js';
import { quotePayrollRow } from '../../src/payouts-invoice.js';
import { USDC_STORAGE_CALL, callPolicy, callsFitRow, payoutsCalls, FERRY_CALL_TARGETS } from '../../../shared/board/session.js';

const BASE = '0x' + '11'.repeat(20);
const YN = 10n ** 24n;
const near = n => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const row = (over = {}) => ({
  per_action_cap: near('0.005'), daily_budget: near('0.01'), max_actions_per_day: 4,
  spent_today: '0', actions_today: 0, balance: near('0.02'), frozen: false, expires_at: '0',
  window_start_min: 0, window_end_min: 0, ...over,
});
const wnear = { assetId: 'nep141:wrap.near', blockchain: 'near', decimals: 24, symbol: 'wNEAR' };
const usdcBase = { assetId: 'nep141:usdc-base', blockchain: 'base', decimals: 6, symbol: 'USDC' };
/** 1Click echoes the request it answered; the echo guard compares every field we sent. */
const quoteResp = (over = {}, sent = null) => ({
  http: 201,
  body: {
    quote: {
      amountInFormatted: '0.041118369688795436030944', amountInUsd: '0.1546', amountOutFormatted: '0.15',
      amountOutUsd: '0.1499', timeEstimate: 24, depositAddress: '0x' + '22'.repeat(20), ...over,
    },
    quoteRequest: sent || {}, signature: 'sig', correlationId: 'cor-1',
  },
});

test('payroll: three chains are priced, sent and capped, not held', () => {
  const rows = [
    { to: 'cafe.near', amt: '0.001', asset: 'NEAR', chain: 'near' },
    { to: BASE, amt: '0.15', asset: 'USDC', chain: 'base' },
    { to: '0x' + '33'.repeat(20), amt: '1', asset: 'USDC', chain: 'arb' },
  ];
  const quotes = {
    [payrollKey(rows[1])]: payrollQuote(rows[1], quoteResp().body),
    [payrollKey(rows[2])]: payrollQuote(rows[2], { quote: { amountInFormatted: '0.27', amountOutFormatted: '1.0' }, correlationId: 'c2' }),
  };
  assert.equal(quotes[payrollKey(rows[1])].ok, true);
  assert.equal(quotes[payrollKey(rows[1])].near > 0, true);
  assert.equal(quotes[payrollKey(rows[1])].chain, 'base');
  const plan = classifyPayroll(rows, { capNear: 0.5, quotes });
  assert.equal(plan.propose.length, 1, 'the NEAR row pays by propose');
  assert.equal(plan.foreign.length, 2, 'both foreign rows are real sends');
  assert.deepEqual(plan.foreign.map(r => r.chain), ['base', 'arb']);
  assert.equal(plan.held.length, 0);
  // Every send row has a NEAR cost the visitor cap can see.
  for (const r of plan.foreign) assert.ok(Number(r.near) > 0, r.chain);
  // A NEAR row over the cap is refused before any deposit; a foreign row with no quote waits.
  const tight = classifyPayroll(rows, { capNear: 0.0005, quotes });
  assert.equal(tight.send.length, 0);
  assert.equal(tight.refused.length, 3);
});

test('payroll: a foreign row needs a payee of its own chain shape', () => {
  assert.equal(foreignAddressOk('base', BASE), true);
  assert.equal(foreignAddressOk('base', 'cafe.near'), false);
  assert.equal(foreignAddressOk('sol', '1'.repeat(32)), true);
  assert.equal(foreignAddressOk('doge', BASE), false);
  const plan = classifyPayroll([{ to: 'cafe.near', amt: '1', asset: 'USDC', chain: 'base' }], { capNear: 1 });
  assert.equal(plan.skipped[0].reason, 'bad_account');
});

test('payroll: a CSV row names its chain, so a Base payroll stays on Base', () => {
  const rows = parseCsv('account,amount,asset,chain\n0x1111111111111111111111111111111111111111,0.15,USDC,base\ncafe.near,0.001,NEAR,near\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].chain, 'base');
  assert.equal(rows[1].chain, 'near');
  const parts = splitAssets(rows);
  assert.equal(parts.usdc.length, 1);
  assert.equal(parts.near.length, 1);
  // An old three-column paste still works and defaults USDC to Base.
  assert.equal(parseCsv('pay.near,0.2,USDC')[0].chain, 'base');
  const receipts = receiptsFor(rows);
  assert.equal(receipts[0].chain, 'base');
  assert.equal(receipts[1].chain, 'near');
});

test('payroll: the row gate mirrors the board checks before a deposit address exists', () => {
  assert.equal(payrollRowGate({ row: row(), amtNear: 0.004 }).ok, true);
  assert.equal(payrollRowGate({ row: row(), amtNear: 0.006 }).reason, 'over_per_action_cap');
  assert.equal(payrollRowGate({ row: row({ frozen: true }), amtNear: 0.001 }).reason, 'frozen');
  assert.equal(payrollRowGate({ row: null, amtNear: 0.001 }).reason, 'no_row');
  assert.equal(payrollRowGate({ row: row({ spent_today: near('0.009') }), amtNear: 0.004 }).reason, 'over_daily_budget');
  assert.equal(payrollRowGate({ row: row({ actions_today: 4 }), amtNear: 0.001 }).reason, 'over_daily_action_count');
  assert.equal(payrollRowGate({ row: row({ balance: '1' }), amtNear: 0.001 }).reason, 'ERR_BALANCE');
  const past = String((BigInt(Date.now() - 60_000) * 1_000_000n));
  assert.equal(payrollRowGate({ row: row({ expires_at: past }), amtNear: 0.001 }).reason, 'clause_expired');
});

test('payroll: checkout input refuses a NEAR row, a bad address and no refund', () => {
  resetPayrollRows();
  assert.equal(payrollCheckoutInput({ chain: 'near', to: 'cafe.near', amt: 1, near: 0.1 }).error, 'a NEAR row is a propose, not a swap');
  assert.equal(payrollCheckoutInput({ chain: 'base', to: 'cafe.near', amt: 1, near: 0.1, refundTo: 'cafe.near' }).error, 'bad recipient for this chain');
  assert.equal(payrollCheckoutInput({ chain: 'base', to: BASE, amt: 1, near: 0.1 }).error, 'bad refundTo: a NEAR account holds the refund');
  assert.equal(payrollCheckoutInput({ chain: 'base', to: BASE, amt: 0, near: 0.1, refundTo: 'cafe.near' }).error, 'bad amount');
  const ok = payrollCheckoutInput({ chain: 'base', to: BASE, amt: 0.15, near: 0.0411, refundTo: 'payer.near' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.chain, 'base');
});

test('payroll: a live checkout asks 1Click only after the row allows it and never sends the deposit', async () => {
  resetPayrollRows();
  let posted = null;
  const out = await openPayrollCheckout(
    { chain: 'base', asset: 'USDC', to: BASE, amt: 0.15, near: 0.0411, refundTo: 'payer.near', slippage: 100 },
    {
      // The row's own cap must hold the wNEAR the signed quote names (0.0411 NEAR here), not the USDC face value.
      row: row({ per_action_cap: near('0.05'), daily_budget: near('0.1'), balance: near('0.5') }),
      tokens: async () => [wnear, usdcBase],
      postQuote: async body => { posted = body; return quoteResp({}, body); },
      verify: () => true,
    },
  );
  assert.equal(out.ok, true);
  assert.equal(posted.dry, false, 'a deposit address needs a live quote');
  assert.equal(posted.swapType, 'EXACT_OUTPUT');
  assert.equal(posted.recipient, BASE);
  assert.equal(posted.recipientType, 'DESTINATION_CHAIN');
  assert.equal(posted.amount, '150000');
  assert.equal(posted.refundTo, 'payer.near');
  assert.equal(out.depositAddress, '0x' + '22'.repeat(20));
  assert.equal(out.status, 'PENDING_DEPOSIT');
  assert.equal(out.receipt.rail, 'intents');
  assert.equal(out.receipt.decision, 'allowed');
  // A quote that costs more NEAR than the row allows is refused after the quote, before any deposit.
  // (A fresh row cache, because the same row key would otherwise replay the success above.)
  resetPayrollRows();
  const dear = await openPayrollCheckout(
    { chain: 'base', asset: 'USDC', to: BASE, amt: 0.15, near: 0.0411, refundTo: 'payer.near' },
    { row: row({ per_action_cap: near('0.01'), daily_budget: near('0.1'), balance: near('0.5') }), tokens: async () => [wnear, usdcBase], postQuote: async body => quoteResp({}, body), verify: () => true },
  );
  assert.equal(dear.reason, 'over_per_action_cap');
  assert.equal(dear.depositAddress, null);
  // Over the row cap: refused, and 1Click is not asked at all.
  let asked = 0;
  const refused = await openPayrollCheckout(
    { chain: 'base', asset: 'USDC', to: BASE, amt: 0.15, near: 0.5, refundTo: 'payer.near' },
    { row: row({ per_action_cap: near('0.04'), daily_budget: near('0.1') }), tokens: async () => [wnear, usdcBase], postQuote: async body => { asked += 1; return quoteResp({}, body); }, verify: () => true },
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'over_per_action_cap');
  assert.equal(asked, 0);
  assert.equal(refused.receipt.decision, 'refused');
});

test('payroll: one row is one swap, so a second click reuses the deposit address', async () => {
  resetPayrollRows();
  let asked = 0;
  const deps = () => ({
    row: row({ per_action_cap: near('0.05'), daily_budget: near('0.1'), balance: near('0.5') }),
    tokens: async () => [wnear, usdcBase],
    postQuote: async body => { asked += 1; return quoteResp({}, body); },
    verify: () => true,
  });
  const body = { owner: 'payer.near', chain: 'base', asset: 'USDC', to: BASE, amt: 0.15, near: 0.0411, refundTo: 'payer.near' };
  const first = await openPayrollCheckout(body, deps());
  assert.equal(first.ok, true);
  assert.equal(first.replayed, false);
  const second = await openPayrollCheckout(body, deps());
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(second.depositAddress, first.depositAddress);
  assert.equal(asked, 1, '1Click is asked once for one row');
  // Another payee or amount is a different row, and does ask.
  const other = await openPayrollCheckout({ ...body, amt: 0.2 }, deps());
  assert.equal(other.replayed, false);
  assert.equal(asked, 2);
  assert.equal(payrollRowId({ owner: 'A.near', chain: 'Base', asset: 'usdc', to: BASE, amt: 0.15 }), payrollRowId({ owner: 'a.near', chain: 'base', asset: 'USDC', to: BASE.toLowerCase(), amt: 0.15 }));
  resetPayrollRows();
});

test('payroll: every 1Click status is plain words and only SUCCESS is paid', () => {
  assert.equal(payrollRowStatus('PENDING_DEPOSIT').text, 'Waiting for the deposit.');
  assert.equal(payrollRowStatus('SUCCESS').paid, true);
  assert.equal(payrollRowStatus('REFUNDED').paid, false);
  assert.equal(payrollRowStatus('FAILED').paid, false);
  for (const s of ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS', 'INCOMPLETE_DEPOSIT', 'REFUNDED', 'FAILED', '']) {
    assert.doesNotMatch(payrollRowStatus(s).text, /[A-Z]{4,}_[A-Z]/, s);
  }
  assert.equal(payrollFeeUsd({ inUsd: 0.1546, outUsd: 0.1499 }), 0.0047);
  assert.equal(payrollFeeUsd({}), null);
});

test('invoice route: a payroll row gets a dry EXACT_OUTPUT price in wNEAR', async () => {
  let sent = null;
  const out = await quotePayrollRow({ chain: 'base', asset: 'USDC', to: BASE, amt: 0.15 }, {
    tokens: async () => [wnear, usdcBase],
    postQuote: async body => { sent = body; return { http: 201, body: { quote: { amountInFormatted: '0.0411', amountInUsd: '0.1546', amountOutFormatted: '0.15', amountOutUsd: '0.1499', timeEstimate: 24 }, quoteRequest: body, signature: 's' } }; },
    checkQuote: () => ({ accepted: true }),
  });
  assert.equal(out.ok, true);
  assert.equal(sent.dry, true, 'pricing a row creates no deposit address');
  assert.equal(out.quote.near, 0.0411);
  assert.equal(out.quote.out, '0.15');
  assert.equal(out.depositAddress, null);
  assert.equal((await quotePayrollRow({ chain: 'near', to: 'cafe.near', amt: 1 }, { tokens: async () => [wnear, usdcBase] })).reason, 'near_row');
  assert.equal((await quotePayrollRow({ chain: 'base', to: 'cafe.near', amt: 1 }, { tokens: async () => [wnear, usdcBase] })).reason, 'bad_recipient');
});

test('sponsorship: bounded by the contract minimum and the visitor own cap', () => {
  const base = { enabled: true, account: 'zero-near.near', minNear: 0.00125, capNear: 0.005, dailyNear: 0.01, spentTodayNear: 0, registered: false };
  const plan = sponsorshipPlan(base);
  assert.equal(plan.ok, true);
  assert.equal(plan.depositNear, Number(USDC_STORAGE_NEAR));
  assert.equal(plan.call.method, 'storage_deposit');
  assert.equal(plan.call.receiver, USDC_NEAR_CONTRACT);
  assert.equal(plan.call.depositNear, Number(USDC_STORAGE_NEAR));
  assert.deepEqual(JSON.parse(plan.call.args), { account_id: 'zero-near.near', registration_only: true });
  assert.match(plan.text, /your own session cap/);
  // Off by default: the deployment decision is the owner's.
  assert.equal(sponsorshipPlan({ ...base, enabled: false }).reason, 'sponsorship_off');
  // Already registered: no repeat payment.
  assert.equal(sponsorshipPlan({ ...base, registered: true }).reason, 'already_registered');
  // Over the visitor cap, over the day, or a row with no balance: refused, never borrowed.
  assert.equal(sponsorshipPlan({ ...base, minNear: 0.02 }).reason, 'over_per_action_cap');
  assert.equal(sponsorshipPlan({ ...base, spentTodayNear: 0.009 }).reason, 'over_daily_budget');
  assert.equal(sponsorshipPlan({ ...base, capNear: null }).reason, 'no_row');
  assert.equal(sponsorshipPlan({ ...base, account: 'not an account' }).reason, 'bad_receive');
  assert.equal(sponsorshipPlan({ ...base, minNear: 0 }).reason, 'no_bounds');
  assert.equal(storageDepositArgs('bad name'), null);
});

test('the row call list carries the USDC storage pair when the row has room', () => {
  const cap = near(0.005);
  assert.equal(USDC_STORAGE_CALL.method, 'storage_deposit');
  const short = payoutsCalls([...FERRY_CALL_TARGETS, { receiver: 'board.nearcarta.near', method: 'stamp', cap }], cap);
  assert.equal(short.fits, true);
  assert.ok(short.calls.some(c => c.receiver === 'storage_deposit') === false);
  assert.ok(short.calls.some(c => c.method === 'storage_deposit'));
  assert.equal(callsFitRow(short.calls), true);
  // The one list the shop and /setup share still fits a default row.
  const policy = callPolicy(['toll.nearcarta.near'], cap, near(0.01), 'ft_transfer', short.calls);
  assert.equal(callsFitRow(policy.calls), true);
  // Nothing in this file is a price: no NEAR cap constant remains in the shop helpers.
  const src = readFileSync(new URL('../../../app/design/D8_shops/js/payouts.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /NEAR_CAP|MAX_ROWS\s*=\s*3/);
  const tray = readFileSync(new URL('../../../app/src/panels/payouts-tray.js', import.meta.url), 'utf8');
  assert.doesNotMatch(tray, /slice\(0,\s*3\)/);
  assert.match(tray, /onForeignPay/);
  assert.match(tray, /payroll\/quote/);
  assert.match(tray, /payouts\/sponsor/);
});

test('guardhouse: a retired charter is not a policy, and an unreadable one is not a 500', async () => {
  // No app import here: the routes pull the whole API in, which is slow under the unit runner.
  // The two units the route is built from are tested directly.
  const { retiredSnapshot } = await import('../../src/guardhouse.js');
  const r = retiredSnapshot('charter.nearcarta.near');
  assert.equal(r.oath, null);
  assert.equal(r.retired, true);
  assert.equal(r.board, 'board.nearcarta.near');
  assert.match(r.why, /retired/);
  const cp = await import('../../src/counterparty.js');
  const unread = async () => { throw new Error('UNKNOWN_ACCOUNT: charter does not exist while viewing'); };
  const v = await cp.check('cafe.near', {
    charter: 'charter.nearcarta.near',
    view: unread,
    viewAccount: async () => ({ code_hash: '11111111111111111111111111111111' }),
    fpost: async () => ({ account_txs: [] }),
  });
  assert.equal(v.verdict, 'warn', 'a check with no readable allowlist warns, it does not throw');
  assert.match(v.signals.charter_unreadable, /UNKNOWN_ACCOUNT/);
  assert.equal(v.charter, 'charter.nearcarta.near');
});

test('source: the tray starts content under the tabs, at the approved Ferry spacing', () => {
  const css = readFileSync(new URL('../../../app/shops/payouts/payouts.css', import.meta.url), 'utf8');
  // The tab bar and the pane are 10px apart, and the pane's first child has no extra top margin.
  assert.match(css, /body\.payouts-tray #shopUI \.ferry-card\{gap:10px\}/);
  assert.match(css, /body\.payouts-tray #shopUI \.ferry-card > \.ferry-tabs\{gap:0;margin:0\}/);
  assert.match(css, /body\.payouts-tray #shopUI \.ferry-pane > :first-child\{margin-top:0\}/);
  // The flow card keeps one fixed height on every tab, so the fields do not move after a create.
  assert.match(css, /height:80px;min-height:80px;max-height:80px/);
  assert.match(css, /align-content:start/);
});

test('CSV reconcile sums what the session did, and paid only from SUCCESS', () => {
  const rows = [
    { to: 'cafe.near', amount: '0.001', asset: 'NEAR', chain: 'near', near: '0.001', status: 'sent', tx: 'A'.repeat(43) },
    { to: BASE, amount: '0.15', asset: 'USDC', chain: 'base', near: '0.0411', feeUsd: 0.0047, refund: 'payer.near', status: 'sent', payoutStatus: 'PENDING_DEPOSIT', payoutText: 'Waiting for the deposit.', tx: 'B'.repeat(43) },
    { to: '0x' + '33'.repeat(20), amount: '1', asset: 'USDC', chain: 'arb', near: '0.27', status: 'refused' },
    { to: 'bob.near', amount: '0.002', asset: 'NEAR', chain: 'near', status: 'not sent' },
  ];
  const block = csvReconcile(rows, { refund: 'payer.near' });
  assert.match(block, /^rows,4/m);
  assert.match(block, /^sent,2/m);
  assert.match(block, /^paid,0/m);
  assert.match(block, /^refused,1/m);
  assert.match(block, /^waiting,1/m);
  assert.match(block, /^near_deposited,0\.3121$/m);
  assert.match(block, /^fees_usd,0\.0047$/m);
  assert.match(block, /^refund_to,payer\.near$/m);
  // A row that says paid without SUCCESS is not paid in the CSV either.
  const csv = accountantCsv([{ to: 'x.near', amount: '1', asset: 'NEAR', chain: 'near', status: 'paid' }]);
  assert.match(csv.split('\n')[1], /not sent/);
  const real = accountantCsv([{ to: BASE, amount: '0.15', asset: 'USDC', chain: 'base', near: '0.04', payoutStatus: 'SUCCESS' }]);
  assert.match(real.split('\n')[1], /paid/);
});
