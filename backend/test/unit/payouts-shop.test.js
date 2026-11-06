// Payouts shop: invoice records and payroll review. No wallet, no network, no signing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MISS_HINT, nearFromYocto, hostedCeiling, classifyPayroll, agentCommand, rowsForCommand, invoiceQuoteBody,
  invoiceDelivered, invoiceStatusLine, cinemaOk, sealText, accountantCsv, canonicalInvoice, invoiceRecordId,
  publicInvoice, registrationVerdict, payrollKey,
} from '../../../app/src/panels/payouts-plan.js';
import { createInvoice, readInvoice, checkoutInvoice, quoteInvoice, resetInvoices, payerInput } from '../../src/payouts-invoice.js';

const TX = '4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia';
const REFUND = '0x' + 'ab'.repeat(20);
const DEPOSIT = 'c'.repeat(64);
const usdcNear = { assetId: 'nep141:usdc-near', blockchain: 'near', decimals: 6, symbol: 'USDC', price: '1' };
const usdcBase = { assetId: 'nep141:usdc-base', blockchain: 'base', decimals: 6, symbol: 'USDC', price: '1' };
const boom = name => () => { throw new Error(`${name} must not be called`); };
const store = () => ({ byId: new Map(), loaded: true });

test('plan: hosted ceiling is config, not a 0.20 product cap', () => {
  assert.equal(hostedCeiling({}).usd, null);
  assert.match(hostedCeiling({}).disclosed, /Not a product price|visitor chooses/i);
  assert.equal(hostedCeiling({ PAYOUTS_USD_CEILING: '2' }).usd, 2);
  assert.equal(nearFromYocto('5000000000000000000000'), 0.005);
  assert.equal(typeof MISS_HINT, 'string');
});

test('plan: classifyPayroll sends the in-cap row, refuses the big one before deposit, holds USDC', () => {
  const rows = [
    { to: 'cafe.near', amt: '0.001', asset: 'NEAR', chain: 'near' },
    { to: 'books.near', amt: '0.02', asset: 'NEAR', chain: 'near' },
    { to: '0x' + '11'.repeat(20), amt: '0.15', asset: 'USDC', chain: 'base' },
  ];
  const p = classifyPayroll(rows, { capNear: 0.005 });
  assert.equal(p.propose.length, 1);
  assert.equal(p.propose[0].to, 'cafe.near');
  assert.equal(p.propose[0].send, true);
  assert.equal(p.refused.length, 1);
  assert.equal(p.refused[0].send, false);
  assert.equal(p.refused[0].reason, 'over_per_action_cap');
  assert.equal(p.held.length, 1);
  assert.equal(p.held[0].reason, 'foreign_effect_unproved');
  assert.equal(p.held[0].send, false);
});

test('plan: classifyPayroll holds every NEAR row when the cap was not read', () => {
  const held = classifyPayroll([{ to: 'cafe.near', amt: '0.001' }], { capNear: null });
  assert.equal(held.rows[0].action, 'hold');
  assert.equal(held.rows[0].send, false);
  assert.equal(held.blocked, true);
  const bad = classifyPayroll([{ to: 'not an account', amt: '0.001', chain: 'near' }], { capNear: 0.005 });
  assert.equal(bad.rows[0].reason, 'bad_account');
});

test('plan: a paid row key does not change if the same row is asked again', () => {
  const a = { to: 'cafe.near', amt: '0.001', asset: 'NEAR', chain: 'near' };
  assert.equal(payrollKey(a), payrollKey({ ...a }));
  assert.notEqual(payrollKey(a), payrollKey({ ...a, amt: '0.002' }));
});

test('plan: agentCommand misses give the hint and a named amount is kept', () => {
  assert.equal(agentCommand('hello').ok, false);
  assert.equal(agentCommand('hello').hint, MISS_HINT);
  assert.equal(agentCommand('Pay reviewed rows').kind, 'pay');
  assert.equal(agentCommand('Send payout 1').index, 0);
  assert.equal(agentCommand('Export accountant CSV').kind, 'csv');
  const inv = agentCommand('Create invoice 0.15 USD on Base USDC');
  assert.equal(inv.ok, true);
  assert.equal(inv.usd, 0.15);
  assert.equal(inv.origin, 'USDC@base');
  const big = agentCommand('Create invoice 1.5 USD');
  assert.equal(big.ok, true);
  assert.equal(big.usd, 1.5);
});

test('plan: rowsForCommand picks one row by index or all of them', () => {
  const rows = [{ to: 'a.near' }, { to: 'b.near' }, { to: 'c.near' }];
  assert.deepEqual(rowsForCommand(rows, { kind: 'pay', index: 1 }), [{ to: 'b.near' }]);
  assert.equal(rowsForCommand(rows, { kind: 'pay', index: null }).length, 3);
});

test('plan: invoiceQuoteBody is EXACT_OUTPUT and does not invent a 0.20 cap', () => {
  const r = invoiceQuoteBody({ from: usdcBase, to: usdcNear, usd: 1.5, recipient: 'cafe.near', refundTo: REFUND });
  assert.equal(r.ok, true);
  assert.equal(r.body.swapType, 'EXACT_OUTPUT');
  assert.equal(r.body.recipient, 'cafe.near');
  assert.equal(r.body.recipientType, 'DESTINATION_CHAIN');
  assert.equal(r.body.amount, '1500000');
  assert.equal(r.depositAddress, null);
  const capped = invoiceQuoteBody({ from: usdcBase, to: usdcNear, usd: 3, recipient: 'cafe.near', refundTo: REFUND, ceiling: hostedCeiling({ PAYOUTS_USD_CEILING: '2' }) });
  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'hosted_abuse_ceiling');
  const bad = invoiceQuoteBody({ from: usdcBase, to: usdcNear, usd: 0.15, recipient: 'not an account', refundTo: REFUND });
  assert.equal(bad.reason, 'near_recipient');
  const refund = invoiceQuoteBody({ from: usdcBase, to: usdcNear, usd: 0.15, recipient: 'cafe.near', refundTo: 'not an address' });
  assert.equal(refund.reason, 'bad_refund');
});

test('plan: the same invoice fields keep one id, and a payer query cannot move the receive account', () => {
  const a = canonicalInvoice({ usd: 0.15, receive: 'cafe.near', memo: 'poster', due: '2026-11-20', expiry: '2026-11-21T18:00:00Z' });
  const b = canonicalInvoice({ usd: '0.15', receive: 'cafe.near', memo: 'poster', due: '2026-11-20', expiry: '2026-11-21T18:00:00Z' });
  assert.equal(a.ok, true);
  assert.equal(invoiceRecordId(a.value), invoiceRecordId(b.value));
  const record = { ...a.value, id: invoiceRecordId(a.value), status: 'UNPAID', depositAddress: null };
  const view = publicInvoice(record, { recipient: 'evil.near', usd: '9', refundTo: REFUND });
  assert.equal(view.receive, 'cafe.near');
  assert.equal(view.usd, 0.15);
  assert.equal(view.redirected, false);
  assert.ok(view.ignoredQuery.includes('recipient'));
  assert.ok(view.ignoredQuery.includes('usd'));
  assert.equal(view.delivered, false);
});

test('plan: invoice status words only call SUCCESS delivered', () => {
  assert.equal(invoiceDelivered('SUCCESS'), true);
  assert.equal(invoiceDelivered('PENDING_DEPOSIT'), false);
  assert.equal(invoiceDelivered('REFUNDED'), false);
  assert.match(invoiceStatusLine('FAILED'), /failed/);
  assert.doesNotMatch(invoiceStatusLine('PENDING_DEPOSIT'), /Paid/);
});

test('plan: registration does not claim gasless when storage is missing or unread', () => {
  const yes = registrationVerdict({ total: '1250000000000000000000' });
  assert.equal(yes.registered, true);
  assert.match(yes.text, /can hold USDC/);
  const no = registrationVerdict(null);
  assert.equal(no.registered, false);
  assert.match(no.text, /storage_deposit/);
  assert.match(no.text, /does not claim the solver/);
  const unread = registrationVerdict(null, { error: 'rpc' });
  assert.equal(unread.claim, 'unread');
  assert.match(unread.text, /Not claimed gasless/);
});

test('plan: cinema and seal stay quiet unless a real step happened', () => {
  assert.equal(cinemaOk([{ decision: 'allowed', tx: TX }]), true);
  assert.equal(cinemaOk([{ decision: 'denied', tx: '', reason: 'over_per_action_cap' }]), false);
  assert.match(sealText([{ decision: 'denied', reason: 'over_per_action_cap' }]), /Refused before any deposit/);
  assert.equal(sealText([{ decision: 'allowed', tx: TX }]), '');
});

test('plan: accountant CSV does not stamp paid without SUCCESS', () => {
  const csv = accountantCsv([
    { source: 'near', to: 'cafe.near', amount: '0.001', asset: 'NEAR', tx: '', status: 'paid' },
    { source: 'base', to: 'cafe.near', amount: '0.15', asset: 'USDC', status: 'SUCCESS', delivered: true, fee: '0.01', refund: REFUND },
  ]);
  const [head, unpaid, paid] = csv.split('\n');
  assert.equal(head, 'source,destination,asset,amount,fee,refund,status,tx');
  assert.match(unpaid, /not sent/);
  assert.doesNotMatch(unpaid, /paid/);
  assert.match(paid, /,paid,/);
});

test('invoice: creating the same bill twice returns one id and does not call 1Click', () => {
  const book = store();
  const body = { usd: 0.15, receive: 'cafe.near', memo: 'poster', due: '2026-11-20', expiry: '' };
  const a = createInvoice(body, { store: book, env: {} });
  const b = createInvoice(body, { store: book, env: {}, postQuote: boom('postQuote') });
  assert.equal(a.ok, true);
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, true);
  assert.equal(a.invoice.id, b.invoice.id);
  assert.equal(a.depositAddress, null);
  assert.equal(a.invoice.delivered, false);
});

test('invoice: a hosted ceiling refuses before tokens or 1Click', async () => {
  const book = store();
  const made = createInvoice({ usd: 5, receive: 'cafe.near' }, { store: book, ceiling: hostedCeiling({ PAYOUTS_USD_CEILING: '2' }) });
  assert.equal(made.ok, false);
  assert.equal(made.reason, 'hosted_abuse_ceiling');
  const quoted = await quoteInvoice({ usd: 5, from: 'USDC@base', recipient: 'cafe.near', refundTo: REFUND }, {
    ceiling: hostedCeiling({ PAYOUTS_USD_CEILING: '2' }), tokens: boom('tokens'), postQuote: boom('postQuote'),
  });
  assert.equal(quoted.reason, 'hosted_abuse_ceiling');
  assert.equal(quoted.depositAddress, null);
});

test('invoice: a payer query cannot redirect, and a second checkout reuses the deposit address', async () => {
  const book = store();
  const made = createInvoice({ usd: 0.15, receive: 'cafe.near', memo: 'poster' }, { store: book, env: {} });
  const tampered = readInvoice(made.invoice.id, { recipient: 'evil.near', usd: '9' }, { store: book });
  assert.equal(tampered.invoice.receive, 'cafe.near');
  assert.equal(tampered.invoice.usd, 0.15);
  assert.equal(tampered.invoice.redirected, false);
  let posts = 0;
  const payer = payerInput({ from: 'USDC@base', refundTo: REFUND, recipient: 'evil.near' }).value;
  const live = await checkoutInvoice(made.invoice.id, payer, {
    store: book,
    env: {},
    tokens: async () => [usdcBase, usdcNear],
    postQuote: async body => {
      posts += 1;
      assert.equal(body.recipient, 'cafe.near');
      assert.equal(body.swapType, 'EXACT_OUTPUT');
      assert.notEqual(body.recipient, 'evil.near');
      return { http: 201, body: { quote: { depositAddress: DEPOSIT }, quoteRequest: body, signature: 'sig' } };
    },
    verify: () => true,
  });
  assert.equal(live.ok, true);
  assert.equal(live.depositAddress, DEPOSIT);
  assert.equal(live.delivered, false);
  const again = await checkoutInvoice(made.invoice.id, payer, { store: book, postQuote: boom('postQuote') });
  assert.equal(again.replayed, true);
  assert.equal(again.depositAddress, DEPOSIT);
  assert.equal(posts, 1);
});

test('invoice: an expired bill does not ask for a deposit address', async () => {
  const book = store();
  const made = createInvoice({ usd: 0.15, receive: 'cafe.near', expiry: '2020-01-01T00:00:00Z' }, { store: book, env: {} });
  const payer = payerInput({ from: 'USDC@base', refundTo: REFUND }).value;
  const out = await checkoutInvoice(made.invoice.id, payer, { store: book, now: Date.parse('2026-11-06T00:00:00Z'), postQuote: boom('postQuote') });
  assert.equal(out.reason, 'expired');
  assert.equal(out.depositAddress, null);
});

test('source: ANY_INPUT is not requested, and the payer page has one checkout button', () => {
  const noComments = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const backend = readFileSync(new URL('../../src/payouts-invoice.js', import.meta.url), 'utf8');
  const plan = readFileSync(new URL('../../../app/src/panels/payouts-plan.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../../app/pay/index.html', import.meta.url), 'utf8');
  assert.equal(noComments(backend).includes('ANY_INPUT'), false);
  assert.equal(noComments(plan).includes('ANY_INPUT'), false);
  assert.match(page, /Pay this invoice/);
  assert.equal((page.match(/ferry-cta/g) || []).length, 1);
  assert.match(page, /Not paid/);
  assert.doesNotMatch(page, /\bPAID\b/);
});
