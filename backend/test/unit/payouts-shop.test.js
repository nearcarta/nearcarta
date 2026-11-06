// Payouts shop: the plan helpers (app/src/panels/payouts-plan.js) and the invoice flow (backend/src/payouts-invoice.js).
// No wallet, no network, no signing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHECKOUT_USD, MISS_HINT, nearFromYocto, classifyPayroll, agentCommand, rowsForCommand, invoiceQuoteBody,
  invoiceDelivered, invoiceStatusLine, cinemaOk, sealText, accountantCsv,
} from '../../../app/src/panels/payouts-plan.js';
import { invoiceInput, quoteInvoice, openInvoice } from '../../src/payouts-invoice.js';

const TX = '4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia';
const REFUND = 'a'.repeat(64);
const usdcNear = { assetId: 'nep141:usdc-near', blockchain: 'near', decimals: 6, symbol: 'USDC', price: '1' };
const usdcBase = { assetId: 'nep141:usdc-base', blockchain: 'base', decimals: 6, symbol: 'USDC', price: '1' };

const caps = {
  per_action_cap: '1000000000000000000000000', daily_budget: '1000000000000000000000000', min_amount: '1',
  max_actions_per_day: 10, window_start_min: 0, window_end_min: 0,
};
const chainFor = receivers => ({
  state: { frozen: false },
  clause: { receivers, ...caps },
  usage: { spent: '0', reserved: '0', count: 0 },
  sealed: false,
});
const boom = name => () => { throw new Error(`${name} must not be called`); };

test('plan: checkout cap, miss hint and yocto to NEAR', () => {
  assert.equal(CHECKOUT_USD, 0.2);
  assert.equal(typeof MISS_HINT, 'string');
  assert.ok(MISS_HINT.length > 0);
  assert.equal(nearFromYocto('5000000000000000000000'), 0.005);
  assert.equal(nearFromYocto('60000000000000000000000'), 0.06);
});

test('plan: classifyPayroll sends the in-cap row, lets the chain refuse the big one, keeps USDC as an invoice', () => {
  const rows = [{ to: 'cafe.near', amt: '0.001' }, { to: 'books.near', amt: '0.02' }, { to: 'me.near', amt: '0.001', asset: 'USDC' }];
  const p = classifyPayroll(rows, { capNear: 0.005 });
  assert.equal(p.propose.length, 1);
  assert.equal(p.propose[0].to, 'cafe.near');
  assert.equal(p.chainRefuse.length, 1);
  assert.equal(p.chainRefuse[0].to, 'books.near');
  assert.equal(p.chainRefuse[0].reason, 'over_per_action_cap');
  assert.equal(p.chainRefuse[0].send, true);
  assert.equal(p.invoices.length, 1);
  assert.equal(p.invoices[0].send, false);
  assert.equal(p.blocked, false);
});

test('plan: classifyPayroll holds every NEAR row when the cap was not read, and skips a bad account', () => {
  const held = classifyPayroll([{ to: 'cafe.near', amt: '0.001' }, { to: 'books.near', amt: '0.02' }], { capNear: null });
  assert.equal(held.rows.length, 2);
  for (const r of held.rows) { assert.equal(r.action, 'hold'); assert.equal(r.send, false); }
  assert.equal(held.blocked, true);
  const bad = classifyPayroll([{ to: 'not an account', amt: '0.001' }], { capNear: 0.005 });
  assert.equal(bad.rows[0].action, 'skip');
  assert.equal(bad.rows[0].reason, 'bad_account');
  assert.equal(bad.blocked, true);
});

test('plan: agentCommand misses give the hint and spend nothing', () => {
  for (const t of ['', 'hello there']) {
    const c = agentCommand(t);
    assert.equal(c.ok, false);
    assert.equal(c.hint, MISS_HINT);
  }
});

test('plan: agentCommand reads pay, prepare and csv', () => {
  assert.deepEqual(agentCommand('Pay these three'), { ok: true, kind: 'pay', index: null, hint: '' });
  const one = agentCommand('Send payout 1');
  assert.equal(one.ok, true); assert.equal(one.kind, 'pay'); assert.equal(one.index, 0);
  assert.equal(agentCommand('Prepare payroll').kind, 'prepare');
  assert.equal(agentCommand('Export accountant CSV').kind, 'csv');
});

test('plan: agentCommand reads invoices and refuses over 0.20 USD', () => {
  const a = agentCommand('Create invoice 0.15 USD on Base USDC');
  assert.equal(a.ok, true); assert.equal(a.kind, 'invoice'); assert.equal(a.usd, 0.15);
  assert.equal(a.origin, 'USDC@base'); assert.equal(a.destination, 'USDC@near');
  const b = agentCommand('Make invoice for 0.15 USDC');
  assert.equal(b.ok, true); assert.equal(b.usd, 0.15); assert.equal(b.origin, 'USDC@near');
  const c = agentCommand('Create invoice 0.25 USD on Base USDC');
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'over_checkout_cap');
  assert.match(c.hint, /0\.20/);
  assert.match(c.hint, /deposit address/);
});

test('plan: rowsForCommand picks one row by index or all of them', () => {
  const rows = [{ to: 'a.near' }, { to: 'b.near' }, { to: 'c.near' }];
  assert.deepEqual(rowsForCommand(rows, { kind: 'pay', index: 1 }), [{ to: 'b.near' }]);
  assert.deepEqual(rowsForCommand(rows, { kind: 'pay', index: null }).map(r => r.to), ['a.near', 'b.near', 'c.near']);
  assert.deepEqual(rowsForCommand(rows, { kind: 'csv' }), []);
});

test('plan: invoiceQuoteBody is a dry EXACT_OUTPUT quote with no deposit address', () => {
  const r = invoiceQuoteBody({ from: usdcBase, to: usdcNear, usd: 0.15, recipient: 'cafe.near', refundTo: REFUND });
  assert.equal(r.ok, true);
  assert.equal(r.body.dry, true);
  assert.equal(r.body.swapType, 'EXACT_OUTPUT');
  assert.notEqual(r.body.swapType, 'ANY_INPUT');
  assert.equal(r.body.recipientType, 'DESTINATION_CHAIN');
  assert.equal(r.body.depositType, 'ORIGIN_CHAIN');
  assert.equal(r.body.amount, '150000');
  assert.equal(r.body.recipient, 'cafe.near');
  assert.equal(r.body.originAsset, 'nep141:usdc-base');
  assert.equal(r.body.destinationAsset, 'nep141:usdc-near');
  assert.equal('depositAddress' in r.body, false);
  assert.equal(r.depositAddress, null);
});

test('plan: invoiceQuoteBody refuses over the cap and a bad NEAR recipient', () => {
  const over = invoiceQuoteBody({ from: usdcBase, to: usdcNear, usd: 0.25, recipient: 'cafe.near', refundTo: REFUND });
  assert.equal(over.ok, false); assert.equal(over.reason, 'over_checkout_cap'); assert.equal(over.body, null);
  const bad = invoiceQuoteBody({ from: usdcBase, to: usdcNear, usd: 0.15, recipient: 'not an account', refundTo: REFUND });
  assert.equal(bad.ok, false); assert.equal(bad.reason, 'near_recipient'); assert.equal(bad.body, null);
});

test('plan: invoice status words only call SUCCESS delivered', () => {
  assert.equal(invoiceDelivered('SUCCESS'), true);
  assert.equal(invoiceDelivered('PENDING_DEPOSIT'), false);
  assert.equal(invoiceDelivered('REFUNDED'), false);
  assert.ok(invoiceStatusLine('SUCCESS').includes('SUCCESS'));
  assert.ok(invoiceStatusLine('REFUNDED').includes('Refunded'));
  const failed = invoiceStatusLine('FAILED');
  assert.ok(failed.includes('failed'));
  assert.doesNotMatch(failed, /Paid/);
});

test('plan: cinemaOk needs every step allowed with a tx hash', () => {
  assert.equal(cinemaOk([{ decision: 'allowed', tx: TX }]), true);
  assert.equal(cinemaOk([{ decision: 'allowed', tx: '' }]), false);
  assert.equal(cinemaOk([{ decision: 'denied', tx: TX, reason: 'over_per_action_cap' }]), false);
  assert.equal(cinemaOk([]), false);
});

test('plan: sealText is empty for allowed, names the refusal, and says Not sent without a tx', () => {
  assert.equal(sealText([{ decision: 'allowed', tx: TX }]), '');
  const withTx = sealText([{ decision: 'denied', tx: TX, reason: 'over_per_action_cap' }]);
  assert.ok(withTx.includes('Charter refused'));
  assert.ok(withTx.includes('over_per_action_cap'));
  const noTx = sealText([{ decision: 'denied', tx: '', reason: 'over_per_action_cap' }]);
  assert.ok(noTx.startsWith('Not sent'));
});

test('plan: accountantCsv marks a row without a tx "not sent" and one with a tx "sent"', () => {
  const unsent = accountantCsv([{ to: 'cafe.near', amount: '0.001', asset: 'NEAR', tx: '' }]);
  const [head, line] = unsent.split('\n');
  assert.equal(head, 'account,amount,asset,tx,status');
  assert.ok(line.includes('not sent'));
  const sent = accountantCsv([{ to: 'cafe.near', amount: '0.001', asset: 'NEAR', tx: TX }]).split('\n')[1];
  assert.equal(sent, `cafe.near,0.001,NEAR,${TX},sent`);
});

test('invoice: invoiceInput checks the body', () => {
  assert.ok(invoiceInput(null).error);
  const ok = invoiceInput({ from: 'USDC@base', usd: 0.15, recipient: 'cafe.near', refundTo: 'cafe.near' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.usd, 0.15);
  assert.ok(invoiceInput({ from: 'USDC@base', usd: 0.15, refundTo: 'cafe.near' }).error);
});

test('invoice: quoteInvoice over 0.20 USD returns before it reads tokens or asks 1Click', async () => {
  const input = invoiceInput({ from: 'USDC@base', usd: 0.25, recipient: 'cafe.near', refundTo: REFUND }).value;
  const r = await quoteInvoice(input, { tokens: boom('tokens'), postQuote: boom('postQuote'), checkQuote: boom('checkQuote') });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'over_checkout_cap');
  assert.equal(r.depositAddress, null);
  assert.equal(r.dry, true);
});

test('invoice: quoteInvoice happy path is a dry EXACT_OUTPUT quote with no deposit address', async () => {
  const input = invoiceInput({ from: 'USDC@base', usd: 0.15, recipient: 'cafe.near', refundTo: REFUND }).value;
  let sent;
  const r = await quoteInvoice(input, {
    tokens: async () => [usdcBase, usdcNear],
    postQuote: async body => {
      sent = body;
      return {
        http: 201,
        body: {
          quote: { amountInFormatted: '0.16', amountOutFormatted: '0.15', amountInUsd: '0.16', amountOutUsd: '0.15' },
          quoteRequest: body, correlationId: 'c1', signature: 'sig',
        },
      };
    },
    checkQuote: () => ({ accepted: true, echo: { ok: true } }),
  });
  assert.equal(sent.swapType, 'EXACT_OUTPUT');
  assert.equal(sent.dry, true);
  assert.equal(r.ok, true);
  assert.equal(r.dry, true);
  assert.equal(r.depositAddress, null);
  assert.equal(r.swapType, 'EXACT_OUTPUT');
  assert.equal(r.status, 'quoted');
  assert.equal(r.correlationId, 'c1');
});

test('invoice: quoteInvoice with a refused quote has no deposit address', async () => {
  const input = invoiceInput({ from: 'USDC@base', usd: 0.15, recipient: 'cafe.near', refundTo: REFUND }).value;
  const r = await quoteInvoice(input, {
    tokens: async () => [usdcBase, usdcNear],
    postQuote: async () => ({ http: 400, body: { message: 'bad' } }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.depositAddress, null);
});

test('invoice: openInvoice over 0.20 USD never calls 1Click', async () => {
  const input = invoiceInput({ from: 'USDC@base', usd: 0.25, recipient: 'cafe.near', refundTo: REFUND }).value;
  const r = await openInvoice(input, { postQuote: boom('postQuote'), tokens: boom('tokens'), readCharter: boom('readCharter') });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'over_checkout_cap');
  assert.equal(r.depositAddress, null);
});

test('invoice: openInvoice stops when the charter cannot be read', async () => {
  const input = invoiceInput({ from: 'USDC@base', usd: 0.15, recipient: 'cafe.near', refundTo: REFUND }).value;
  const r = await openInvoice(input, { readCharter: async () => { throw new Error('rpc down'); }, postQuote: boom('postQuote') });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'charter_unread');
  assert.equal(r.depositAddress, null);
});

test('invoice: openInvoice stops when the charter does not allow the recipient', async () => {
  const input = invoiceInput({ from: 'USDC@base', usd: 0.15, recipient: 'cafe.near', refundTo: REFUND }).value;
  const r = await openInvoice(input, { readCharter: async () => chainFor(['other.near']), postQuote: boom('postQuote'), tokens: boom('tokens') });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'receiver_not_allowlisted');
  assert.equal(r.depositAddress, null);
});

test('invoice: openInvoice after a passing charter and a refused quote has no deposit address', async () => {
  const input = invoiceInput({ from: 'USDC@base', usd: 0.15, recipient: 'cafe.near', refundTo: REFUND }).value;
  let posted = 0;
  const r = await openInvoice(input, {
    readCharter: async () => chainFor(['cafe.near']),
    tokens: async () => [usdcBase, usdcNear],
    postQuote: async body => { posted++; assert.equal(body.swapType, 'EXACT_OUTPUT'); assert.equal(body.dry, false); return { http: 400, body: { message: 'bad' } }; },
  });
  assert.equal(posted, 1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'quote_refused');
  assert.equal(r.depositAddress, null);
});

test('source: ANY_INPUT is not requested by the invoice code', () => {
  const noComments = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const backend = readFileSync(new URL('../../src/payouts-invoice.js', import.meta.url), 'utf8');
  const plan = readFileSync(new URL('../../../app/src/panels/payouts-plan.js', import.meta.url), 'utf8');
  assert.equal(noComments(backend).includes('ANY_INPUT'), false);
  assert.equal(noComments(plan).includes('ANY_INPUT'), false);
  const r = invoiceQuoteBody({ from: usdcBase, to: usdcNear, usd: 0.2, recipient: 'cafe.near', refundTo: REFUND });
  assert.equal(r.ok, true);
  assert.equal(r.body.swapType, 'EXACT_OUTPUT');
});
