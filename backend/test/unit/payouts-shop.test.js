// Payouts shop: invoice records and payroll review. No wallet, no network, no signing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MISS_HINT, nearFromYocto, hostedCeiling, classifyPayroll, agentCommand, rowsForCommand, invoiceQuoteBody,
  invoiceDelivered, invoiceStatusLine, cinemaOk, sealText, accountantCsv, canonicalInvoice, invoiceRecordId,
  publicInvoice, registrationVerdict, payrollKey, addressOk, quoteLine, invoiceDoneLine, paymentLinks, usdcChoices,
  relativeInvoiceDates, agentInvoiceReply, acceptModelIntent, indicativeRefund,
} from '../../../app/src/panels/payouts-plan.js';
import { qrSvg } from '../../../app/src/panels/qr-svg.js';
import { createInvoice, readInvoice, checkoutInvoice, quoteInvoice, quoteStored, resetInvoices, payerInput, registrationOf, listInvoices } from '../../src/payouts-invoice.js';
import { parsePayoutIntent } from '../../src/payouts-intent.js';

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

test('plan: classifyPayroll sends the in-cap rows, refuses the big one before deposit, prices the foreign row', () => {
  const rows = [
    { to: 'cafe.near', amt: '0.001', asset: 'NEAR', chain: 'near' },
    { to: 'books.near', amt: '0.02', asset: 'NEAR', chain: 'near' },
    { to: '0x' + '11'.repeat(20), amt: '0.15', asset: 'USDC', chain: 'base' },
  ];
  const foreign = rows[2];
  // A foreign row is paid by the same session through the 1Click rail; its NEAR cost is the quote.
  const key = payrollKey(foreign);
  const priced = classifyPayroll(rows, { capNear: 0.05, quotes: { [key]: { ok: true, near: 0.0411, out: '0.15' } } });
  assert.equal(priced.propose.length, 2);
  assert.equal(priced.propose[0].to, 'cafe.near');
  assert.equal(priced.propose[0].send, true);
  assert.equal(priced.refused.length, 0);
  assert.equal(priced.foreign.length, 1);
  assert.equal(priced.foreign[0].to, foreign.to);
  assert.equal(priced.foreign[0].action, 'send');
  assert.equal(priced.foreign[0].near, 0.0411);
  assert.equal(priced.held.length, 0);
  // A NEAR row over the visitor's cap is still refused before any deposit.
  const tight = classifyPayroll(rows, { capNear: 0.005, quotes: { [key]: { ok: true, near: 0.0411 } } });
  assert.equal(tight.refused.length, 2);
  assert.deepEqual(tight.refused.map(r => r.reason), ['over_per_action_cap', 'over_per_action_cap']);
  assert.equal(tight.refused[0].to, 'books.near');
  assert.equal(tight.foreign.length, 0);
  // No quote yet: the row waits, and nothing is sent for it.
  const waiting = classifyPayroll(rows, { capNear: 0.2 });
  assert.equal(waiting.needsQuote.length, 1);
  assert.equal(waiting.needsQuote[0].reason, 'quote_needed');
  assert.equal(waiting.send.length, 2);
  assert.equal(waiting.blocked, false);
  // A quote whose NEAR cost is over the cap is refused before any deposit.
  const dear = classifyPayroll([foreign], { capNear: 0.01, quotes: { [key]: { ok: true, near: 0.05 } } });
  assert.equal(dear.refused.length, 1);
  assert.equal(dear.refused[0].reason, 'over_per_action_cap');
  // A refused quote is refused, not sent.
  const bad = classifyPayroll([foreign], { capNear: 1, quotes: { [key]: { ok: false, reason: 'quote_refused' } } });
  assert.equal(bad.refused.length, 1);
  assert.equal(bad.send.length, 0);
  // A foreign payee must be an address of its chain's shape.
  const wrong = classifyPayroll([{ to: 'not-an-address', amt: '1', asset: 'USDC', chain: 'base' }], { capNear: 1 });
  assert.equal(wrong.skipped[0].reason, 'bad_account');
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
  assert.equal(invoiceStatusLine('PENDING_DEPOSIT'), 'Waiting for your deposit.');
  assert.equal(invoiceStatusLine('KNOWN_DEPOSIT_TX'), 'The deposit was seen. Not paid yet.');
  assert.equal(invoiceStatusLine('PROCESSING'), 'The deposit was seen. Not paid yet.');
  assert.doesNotMatch(invoiceStatusLine('SUCCESS'), /SUCCESS/);
  assert.doesNotMatch(invoiceStatusLine('REFUNDED'), /REFUNDED/);
});

test('plan: registration names registered, who pays, or unknown', () => {
  const yes = registrationVerdict({ total: '1250000000000000000000' });
  assert.equal(yes.registered, true);
  assert.match(yes.text, /Registered for USDC/);
  assert.match(yes.text, /can hold USDC/);
  const no = registrationVerdict(null);
  assert.equal(no.registered, false);
  assert.match(no.text, /storage deposit/);
  assert.match(no.text, /your own session cap/);
  assert.match(no.text, /0\.00125 NEAR/);
  assert.match(registrationVerdict(null, { account: 'zero-near.near' }).text, /register zero-near\.near/);
  const unread = registrationVerdict(null, { error: 'rpc' });
  assert.equal(unread.ok, true);
  assert.equal(unread.claim, 'unknown');
  assert.match(unread.text, /unknown/);
  assert.match(unread.text, /invoice is still valid/);
  for (const row of [yes, no, unread]) assert.doesNotMatch(row.text, /gasless/i);
});

test('plan: cinema and seal stay quiet unless a real step happened', () => {
  assert.equal(cinemaOk([{ decision: 'allowed', tx: TX }]), true);
  assert.equal(cinemaOk([{ decision: 'denied', tx: '', reason: 'over_per_action_cap' }]), false);
  assert.match(sealText([{ decision: 'denied', reason: 'over_per_action_cap' }]), /Refused before any deposit/);
  assert.equal(sealText([{ decision: 'allowed', tx: TX }]), '');
});

test('plan: accountant CSV does not stamp paid without SUCCESS', () => {
  const csv = accountantCsv([
    { source: 'near', chain: 'near', to: 'cafe.near', amount: '0.001', asset: 'NEAR', tx: '', status: 'paid' },
    { source: 'near', chain: 'base', to: 'cafe.near', amount: '0.15', asset: 'USDC', status: 'SUCCESS', delivered: true, near: '0.0411', feeUsd: '0.01', refund: REFUND },
  ]);
  const [head, unpaid, paid] = csv.split('\n');
  assert.equal(head, 'source,chain,destination,asset,amount,near,fee_usd,refund,status,tx');
  assert.match(unpaid, /not sent/);
  assert.doesNotMatch(unpaid, /,paid,/);
  assert.match(paid, /,paid,/);
  // The foreign row carries its chain, the fee the route charged and the refund address.
  assert.match(paid, /^near,base,cafe\.near,USDC,0\.15,0\.0411,0\.01,0xabab/);
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

test('invoice: USDC storage reads the short contract and a missing account is an error', async () => {
  const calls = [];
  const seen = await registrationOf('nearcarta.near', {
    viewAccount: async () => ({ amount: '1' }),
    view: async (contract, method, args) => {
      calls.push({ contract, method, args });
      if (method === 'storage_balance_of') return { total: '1250000000000000000000', available: '0' };
      if (method === 'storage_balance_bounds') return { min: '1250000000000000000000' };
      throw new Error(method);
    },
  });
  assert.equal(seen.ok, true);
  assert.equal(seen.claim, 'registered');
  assert.equal(calls[0].contract, '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');
  assert.equal(calls[0].contract.includes('.factory.bridge.near'), false);
  assert.deepEqual(calls[0].args, { account_id: 'nearcarta.near' });
  let views = 0;
  const missing = await registrationOf('no-such-payouts-account.near', {
    viewAccount: async () => { const e = new Error('account no-such-payouts-account.near does not exist while viewing'); e.name = 'UNKNOWN_ACCOUNT'; throw e; },
    view: async () => { views += 1; return null; },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'missing_account');
  assert.equal(views, 0);
  assert.match(missing.text, /does not exist on NEAR/);
  const tried = [];
  const unknown = await registrationOf('alice.near', {
    viewAccount: async () => ({}),
    view: async (contract) => { tried.push(contract); throw new Error('Account ID is too long'); },
  });
  assert.equal(unknown.ok, true);
  assert.equal(unknown.claim, 'unknown');
  assert.equal(tried[0], '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');
  assert.match(tried[1], /factory\.bridge\.near$/);
});

test('invoice: a dry quote names the send amount, the fee and the time', async () => {
  const quoted = await quoteInvoice({ usd: 0.15, from: 'USDC@base', recipient: 'cafe.near', refundTo: REFUND }, {
    tokens: async () => [usdcBase, usdcNear],
    postQuote: async () => ({ http: 201, body: { quote: { amountInFormatted: '0.151549', amountInUsd: '0.1515', amountOutFormatted: '0.15', amountOutUsd: '0.15', timeEstimate: 35 }, quoteRequest: {}, signature: 'sig' } }),
    checkQuote: () => ({ accepted: true }),
  });
  assert.equal(quoted.depositAddress, null);
  assert.equal(quoted.send, '0.151549');
  assert.equal(quoted.seconds, 35);
  assert.match(quoteLine(quoted), /You send 0.151549 USDC/);
  assert.match(quoteLine(quoted), /35 seconds/);
  const low = await quoteInvoice({ usd: 0.01, from: 'USDC@base', recipient: 'cafe.near', refundTo: REFUND }, {
    tokens: async () => [usdcBase, usdcNear],
    postQuote: async () => ({ http: 400, body: { message: 'Amount is too low for bridge, try at least 149983' } }),
  });
  assert.equal(low.depositAddress, null);
  assert.match(low.error, /0\.15 USDC/);
});

test('plan: the agent reply names the invoice and a pay link becomes a QR', () => {
  const cmd = agentCommand('Create invoice 0.15 USD to alice.near memo logo design');
  assert.equal(cmd.receive, 'alice.near');
  assert.equal(cmd.memo, 'logo design');
  const line = invoiceDoneLine({ id: 'inv_abc', usd: 0.15, receive: 'alice.near', memo: 'logo design', expiry: '2026-11-20T18:00:00Z', href: '/pay/inv_abc' }, 'https://nearcarta.vercel.app');
  assert.match(line, /0\.15 USDC to alice\.near/);
  assert.match(line, /logo design/);
  assert.match(line, /https:\/\/nearcarta\.vercel\.app\/pay\/inv_abc/);
  assert.match(line, /signs nothing/);
  assert.equal(addressOk('sol', '1'.repeat(32)), true);
  assert.equal(addressOk('op', REFUND), true);
  assert.equal(addressOk('base', 'not-an-address'), false);
  const choices = usdcChoices([
    { symbol: 'USDC', blockchain: 'base', assetId: 'nep141:base' },
    { symbol: 'USDC', chain: 'near', assetId: 'nep141:near' },
    { symbol: 'USDC', blockchain: 'sol', assetId: 'nep141:sol' },
  ]);
  assert.deepEqual(choices.map(c => c.id), ['base', 'sol']);
  const links = paymentLinks({ destinationTx: 'H'.repeat(32), originTx: '0x' + 'ab'.repeat(32), chain: 'base' });
  assert.match(links[0].href, /nearblocks\.io/);
  assert.match(links[1].href, /basescan\.org/);
  const svg = qrSvg('https://nearcarta.vercel.app/pay/inv_abc');
  assert.match(svg, /<svg/);
  assert.match(svg, /<path/);
});

test('source: the tray keeps amount empty, reserves status, and stops key events', () => {
  const tray = readFileSync(new URL('../../../app/src/panels/payouts-tray.js', import.meta.url), 'utf8');
  const world = readFileSync(new URL('../../../app/design/D9_world/js/main.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../../../app/design/D8_shops/js/shopui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(tray, /invoiceUsd = '0\.15'/);
  assert.doesNotMatch(tray, /per-row cap/);
  assert.doesNotMatch(tray, /Amount USD/);
  assert.match(tray, /Amount \(USDC\)/);
  assert.match(tray, /relativeInvoiceDates/);
  assert.match(tray, /data-tab="invoices"/);
  assert.match(tray, /Your board cap/);
  assert.match(tray, /type="date"/);
  assert.match(tray, /type="datetime-local"/);
  assert.match(tray, /Creating an invoice signs nothing/);
  assert.match(tray, /stopPropagation/);
  assert.match(world, /pin\.inert/);
  assert.match(world, /shopFieldFocused/);
  assert.match(ui, /stopPropagation/);
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
  assert.match(page, /Amount \(USDC\)/);
  assert.doesNotMatch(page, /Amount USD/);
  assert.doesNotMatch(page, /\bPAID\b/);
  const payJs = readFileSync(new URL('../../../app/src/panels/pay-invoice.js', import.meta.url), 'utf8');
  assert.match(payJs, /payload\.indicative = true/);
  assert.match(payJs, /invoiceStatusLine/);
  assert.doesNotMatch(payJs, /status !== 'UNPAID' \? status/);
  assert.doesNotMatch(payJs, /Add a refund address to see/);
  const css = readFileSync(new URL('../../../app/shops/payouts/payouts.css', import.meta.url), 'utf8');
  assert.match(css, /top:96px/);
  assert.match(css, /max-height:none/);
  assert.match(css, /height:80px/);
  assert.match(css, /align-content:start/);
});

test('plan: due and expiry are counted from today', () => {
  const now = new Date(2026, 0, 1, 10, 0, 0);
  const dates = relativeInvoiceDates(now);
  assert.equal(dates.due, '2026-01-08');
  assert.equal(dates.expiry, '2026-01-15T18:00');
  const later = relativeInvoiceDates(new Date(2026, 10, 6, 9, 0, 0));
  assert.equal(later.due, '2026-11-13');
  assert.notEqual(later.due, dates.due);
});

test('plan: free text fills the payee, the amount, the memo and the due date', () => {
  const now = new Date(2026, 10, 6, 9, 0, 0);
  const hex = 'ab'.repeat(32);
  const phrases = [
    ['bill alice.near 0.3 USDC for the April article', { usd: 0.3, receive: 'alice.near', memo: 'the April article', due: '' }],
    ['send 0.5 USDC to cafe.near for coffee', { usd: 0.5, receive: 'cafe.near', memo: 'coffee', due: '' }],
    ['Create invoice 0.15 USD to bob.near memo logo design', { usd: 0.15, receive: 'bob.near', memo: 'logo design', due: '' }],
    [`charge ${hex} 2 USDC for the audit`, { usd: 2, receive: hex, memo: 'the audit', due: '' }],
    ['invoice 1 USDC to dana.near due 2026-12-01 memo website', { usd: 1, receive: 'dana.near', memo: 'website', due: '2026-12-01' }],
    ['bill alice.near $0.4 due tomorrow for the poster', { usd: 0.4, receive: 'alice.near', memo: 'the poster', due: '2026-11-07' }],
    ['Create an invoice for 0.2 USDC to bob.near for design work', { usd: 0.2, receive: 'bob.near', memo: 'design work', due: '' }],
    ['bill bob.near 0.2 USDC', { usd: 0.2, receive: 'bob.near', memo: '', due: '' }],
    ['invoice alice.near 0.4 USDC memo the April article', { usd: 0.4, receive: 'alice.near', memo: 'the April article', due: '' }],
  ];
  assert.ok(phrases.length >= 6);
  for (const [text, want] of phrases) {
    const cmd = agentCommand(text, now);
    assert.equal(cmd.ok, true, text);
    assert.equal(cmd.kind, 'invoice', text);
    assert.equal(cmd.usd, want.usd, text);
    assert.equal(cmd.receive, want.receive, text);
    assert.equal(cmd.memo, want.memo, text);
    assert.equal(cmd.due, want.due, text);
  }
  assert.equal(agentCommand('pay these rows').kind, 'pay');
  assert.equal(agentCommand('export csv').kind, 'csv');
  const reply = agentInvoiceReply(
    { usd: 0.3, receive: 'alice.near', memo: 'the April article', due: '2026-11-13', href: '/pay/inv_abc' },
    'https://nearcarta.vercel.app',
  );
  assert.match(reply, /^Made a 0\.3 USDC invoice to alice\.near for the April article, due 2026-11-13\. Here is the link\. https:\/\/nearcarta\.vercel\.app\/pay\/inv_abc$/);
  assert.equal(reply.split('0.3 USDC').length, 2);
  const noisy = agentInvoiceReply(
    { usd: 0.2, receive: 'bob.near', memo: 'design work', due: '2026-11-13', href: '/pay/inv_bob' },
    'https://nearcarta.vercel.app',
  );
  assert.match(noisy, /^Made a 0\.2 USDC invoice to bob\.near for design work, due 2026-11-13\. Here is the link\. /);
  assert.doesNotMatch(noisy, /for 0\.2 USDC/);
  assert.doesNotMatch(noisy, /signs nothing/);
});

test('plan: a model that invents a payee or raises the amount is kept to the words', () => {
  const text = 'bill alice.near 0.3 USDC for the April article';
  const fallback = agentCommand(text);
  const invented = acceptModelIntent(text, { kind: 'invoice', usd: 0.3, receive: 'evil.near', memo: 'the April article' }, fallback);
  assert.equal(invented.receive, 'alice.near');
  assert.equal(invented.source, 'parser');
  const raised = acceptModelIntent(text, { kind: 'invoice', usd: 9, receive: 'alice.near', memo: 'the April article' }, fallback);
  assert.equal(raised.usd, 0.3);
  assert.equal(raised.source, 'parser');
  const kept = acceptModelIntent(text, { kind: 'invoice', usd: 0.3, receive: 'alice.near', memo: 'the April article' }, fallback);
  assert.equal(kept.source, 'model');
  assert.equal(kept.usd, 0.3);
  const long = 'Create an invoice for 0.2 USDC to bob.near for design work';
  const copied = acceptModelIntent(long, { kind: 'invoice', usd: 0.2, receive: 'bob.near', memo: '0.2 USDC to bob.near for design work' }, agentCommand(long));
  assert.equal(copied.memo, 'design work');
  assert.equal(copied.receive, 'bob.near');
  assert.equal(agentCommand('bill bob.near 0.2 USDC').memo, '');
  const bare = acceptModelIntent('bill alice.near for the April article', { kind: 'invoice', usd: 0.3, receive: 'alice.near' }, agentCommand('bill alice.near for the April article'));
  assert.equal(bare.ok, false);
});

test('intent: no key and a failed model both use the parser', async () => {
  const text = 'bill alice.near 0.3 USDC for the April article';
  const offline = await parsePayoutIntent(text, { hasKey: () => false, complete: () => { throw new Error('must not call'); } });
  assert.equal(offline.source, 'parser');
  assert.equal(offline.usd, 0.3);
  assert.equal(offline.receive, 'alice.near');
  const failed = await parsePayoutIntent(text, {
    hasKey: () => true,
    allow: () => ({ ok: true }),
    preflight: async () => ({ ok: true }),
    complete: async () => { throw new Error('model down'); },
    skipBudget: true,
  });
  assert.equal(failed.source, 'parser');
  assert.equal(failed.memo, 'the April article');
  const model = await parsePayoutIntent(text, {
    hasKey: () => true,
    allow: () => ({ ok: true }),
    preflight: async () => ({ ok: true }),
    complete: async () => ({ content: '{"kind":"invoice","usd":0.3,"receive":"alice.near","memo":"the April article","due":""}', usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    skipBudget: true,
  });
  assert.equal(model.source, 'model');
  assert.equal(model.receive, 'alice.near');
});

test('invoice: an indicative quote does not need a refund, and checkout still does', async () => {
  const open = payerInput({ from: 'USDC@base', chain: 'base', indicative: true }, { allowIndicative: true });
  assert.equal(open.ok, true);
  assert.equal(open.value.indicative, true);
  assert.equal(addressOk('base', open.value.refundTo), true);
  assert.equal(payerInput({ from: 'USDC@base', chain: 'base' }).error, 'bad refundTo');
  for (const chain of ['base', 'sol', 'sui', 'stellar', 'near']) assert.equal(addressOk(chain, indicativeRefund(chain)), true, chain);
  const book = store();
  const made = createInvoice({ usd: 0.15, receive: 'cafe.near', visitor: 'alice.near' }, { store: book, env: {} });
  let saw = '';
  const quoted = await quoteStored(made.invoice.id, open.value, {
    store: book,
    tokens: async () => [usdcBase, usdcNear],
    postQuote: async (body) => { saw = body.refundTo; return { http: 201, body: { quote: { amountInFormatted: '0.151549', amountInUsd: '0.1515', amountOutFormatted: '0.15', amountOutUsd: '0.15', timeEstimate: 35 }, quoteRequest: body } }; },
    checkQuote: () => ({ accepted: true }),
  });
  assert.equal(quoted.ok, true);
  assert.equal(quoted.indicative, true);
  assert.equal(quoted.depositAddress, null);
  assert.equal(saw, open.value.refundTo);
  assert.match(quoteLine(quoted), /0\.151549 USDC/);
});

test('invoice: the list is per visitor and names Unpaid, Paid, or Expired', () => {
  const book = store();
  const now = Date.parse('2026-11-06T12:00:00Z');
  createInvoice({ usd: 0.3, receive: 'alice.near', memo: 'april', due: '2026-11-13', expiry: '2026-12-01T00:00:00Z', visitor: 'visitor.near' }, { store: book, env: {}, now });
  createInvoice({ usd: 0.2, receive: 'bob.near', memo: 'old', expiry: '2020-01-01T00:00:00Z', visitor: 'visitor.near' }, { store: book, env: {}, now });
  createInvoice({ usd: 1, receive: 'cafe.near', memo: 'other', visitor: 'other.near' }, { store: book, env: {}, now });
  const row = [...book.byId.values()].find(r => r.receive === 'alice.near');
  row.status = 'SUCCESS';
  const mine = listInvoices('visitor.near', { store: book, now });
  assert.equal(mine.ok, true);
  assert.equal(mine.invoices.length, 2);
  assert.deepEqual(mine.invoices.map(i => i.listStatus).sort(), ['Expired', 'Paid']);
  const other = listInvoices('other.near', { store: book, now });
  assert.equal(other.invoices.length, 1);
  assert.equal(other.invoices[0].listStatus, 'Unpaid');
  assert.equal(other.invoices[0].receive, 'cafe.near');
  assert.equal(listInvoices('', { store: book }).ok, false);
  const again = createInvoice({ usd: 1, receive: 'cafe.near', memo: 'other', visitor: 'guest-2' }, { store: book, env: {}, now });
  assert.equal(again.replayed, true);
  assert.equal(listInvoices('guest-2', { store: book, now }).invoices.length, 1);
});

// A freelancer invoice needs line items before a normal company can use it. The total is SUMMED
// from the lines, so a bill can never show work that does not add up to the amount charged — and
// an `usd` passed next to items cannot override them.
test('an invoice with line items sums them and ignores a conflicting total', () => {
  const inv = canonicalInvoice({ receive: 'alice.near', usd: 999, items: [
    { label: 'Article', qty: 2, usd: 0.15 },
    { label: 'Edit pass', qty: 1, usd: 0.05 },
  ] });
  assert.equal(inv.ok, true);
  assert.equal(inv.value.usd, 0.35, 'the lines decide the total');
  assert.equal(inv.value.items.length, 2);
  assert.equal(inv.value.items[0].usd, 0.3, 'qty multiplies the unit price');
  assert.deepEqual(inv.value.items[1], { label: 'Edit pass', qty: 1, usd: 0.05, each: 0.05 });
});

test('items that cannot be read fall back to the single amount, and never silently to zero', () => {
  const kept = canonicalInvoice({ receive: 'alice.near', usd: 0.2, items: [{ label: '', usd: 5 }] });
  assert.equal(kept.value.usd, 0.2, 'a line with no label is dropped, so the amount stands');
  assert.deepEqual(kept.value.items, []);
  const none = canonicalInvoice({ receive: 'alice.near', items: [{ label: '', usd: 5 }] });
  assert.equal(none.ok, false, 'no readable line and no amount is refused, not billed at 0');
  assert.equal(none.reason, 'bad_usd');
});

test('two invoices with the same total but different work are different bills', () => {
  const a = canonicalInvoice({ receive: 'alice.near', items: [{ label: 'Article', qty: 1, usd: 1 }] });
  const b = canonicalInvoice({ receive: 'alice.near', items: [{ label: 'Illustration', qty: 1, usd: 1 }] });
  assert.notEqual(invoiceRecordId(a.value), invoiceRecordId(b.value));
  const again = canonicalInvoice({ receive: 'alice.near', items: [{ label: 'Article', qty: 1, usd: 1 }] });
  assert.equal(invoiceRecordId(a.value), invoiceRecordId(again.value), 'the same bill is still idempotent');
});

test('what can you do returns the try-hint, and the invoice pane names the board cap', () => {
  const miss = agentCommand('What can you do in this shop? Show me the safest first step.');
  assert.equal(miss.ok, false);
  assert.match(miss.hint, /bill alice\.near|Try:/i);
  const tray = readFileSync(new URL('../../../app/src/panels/payouts-tray.js', import.meta.url), 'utf8');
  assert.match(tray, /data-testid="payout-invoice-cap"/);
  assert.match(tray, /Your board cap/);
  assert.match(tray, /Sign in and open \/setup so this desk can read your board cap/);
});
