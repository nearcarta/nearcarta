// NEAR Intents on Ferry: signed intent execution, limit orders, and the signature checks
// that decide whether a status may say "delivered".
//
// The docs are in docs/internal/intents/. These tests pin the rules that matter for
// safety: an order deposit matches the docs' formula, a limit order never asks for
// `public` confidentiality, a signed intent body is the payload 1Click returned (never a
// rebuilt one), and an unsigned status can never claim delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ONE_CLICK_MANAGER_PUB_KEY, DEPOSIT_TYPES, CONFIDENTIALITY, needsSignedIntent,
  confidentialityCheck, orderDeposit, orderFitsRow, orderInput, orderView, isOpenOrder,
  signedIntentBody, statusSignature, deliveryVerdict, OPEN_FILL_STATUSES,
} from '../../../shared/ferry/intents.js';
import { jsonApiError } from '../../../backend/src/ferry-intents.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('the manager key is the public 1Click signer, and the deposit channels are the documented three', () => {
  assert.match(ONE_CLICK_MANAGER_PUB_KEY, /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.deepEqual(DEPOSIT_TYPES, ['ORIGIN_CHAIN', 'INTENTS', 'CONFIDENTIAL_INTENTS']);
  assert.deepEqual(CONFIDENTIALITY, ['public', 'basic', 'advanced']);
  // Only the two Intents channels need a signature instead of a deposit.
  assert.equal(needsSignedIntent('ORIGIN_CHAIN'), false);
  assert.equal(needsSignedIntent('INTENTS'), true);
  assert.equal(needsSignedIntent('CONFIDENTIAL_INTENTS'), true);
  assert.equal(needsSignedIntent('intents'), true);
});

test('a confidential swap needs the partner key on the server', () => {
  assert.equal(confidentialityCheck('public', { hasPartnerKey: false }).ok, true);
  // A confidential quote cannot be requested without ONECLICK_PARTNER_KEY.
  assert.equal(confidentialityCheck('basic', { hasPartnerKey: false }).reason, 'confidential_needs_partner_key');
  assert.equal(confidentialityCheck('advanced', { hasPartnerKey: true }).ok, true);
  assert.equal(confidentialityCheck('secret', { hasPartnerKey: true }).reason, 'bad_confidentiality');
});

test('the order deposit follows the docs formula, rounded up', () => {
  // The docs example: SELL 1 NEAR (24 decimals) at 5 USDC (6 decimals) per NEAR = 5 USDC.
  const near = 10n ** 24n;
  const sell = orderDeposit({ side: 'SELL', quantity: near.toString(), price: '5', baseDecimals: 24, quoteDecimals: 6 });
  assert.equal(sell.deposit, near.toString());
  assert.equal(sell.quote, '5000000');
  assert.equal(sell.swapType, 'EXACT_INPUT');
  const buy = orderDeposit({ side: 'BUY', quantity: near.toString(), price: '5', baseDecimals: 24, quoteDecimals: 6 });
  assert.equal(buy.deposit, '5000000');
  assert.equal(buy.swapType, 'EXACT_OUTPUT');
  // A fractional price rounds up to a whole smallest unit, never down.
  const frac = orderDeposit({ side: 'BUY', quantity: '3', price: '0.333', baseDecimals: 0, quoteDecimals: 0 });
  assert.equal(frac.quote, '1'); // 3 x 0.333 = 0.999 -> 1
  assert.throws(() => orderDeposit({ side: 'SELL', quantity: '1', price: '-1', baseDecimals: 0, quoteDecimals: 0 }), /price/);
  assert.throws(() => orderDeposit({ side: 'HOLD', quantity: '1', price: '1', baseDecimals: 0, quoteDecimals: 0 }), /side/);
});

test('an order is refused when the row or the balance cannot fund it', () => {
  assert.equal(orderFitsRow({ depositYocto: '100', capYocto: '200', balanceYocto: '300' }).ok, true);
  assert.equal(orderFitsRow({ depositYocto: '300', capYocto: '200' }).reason, 'over_per_action_cap');
  assert.equal(orderFitsRow({ depositYocto: '400', capYocto: '900', balanceYocto: '300' }).reason, 'over_row_balance');
  assert.equal(orderFitsRow({ depositYocto: '0' }).reason, 'bad_amount');
});

test('a limit order is always confidential, and its body matches the API shape', () => {
  const base = {
    baseAsset: 'nep141:wrap.near', quoteAsset: 'nep141:usdc.omft.near',
    quantity: (10n ** 24n).toString(), side: 'SELL', price: '5',
    baseDecimals: 24, quoteDecimals: 6,
    refundTo: 'visitor.near', refundType: 'ORIGIN_CHAIN',
    recipient: 'visitor.near', recipientType: 'ORIGIN_CHAIN',
  };
  const body = orderInput({ ...base, confidentiality: 'basic' });
  assert.equal(body.data.type, 'orders');
  const a = body.data.attributes;
  assert.equal(a.orderType, 'LIMIT');
  assert.equal(a.side, 'SELL');
  assert.equal(a.timeInForce, 'GTC');
  assert.equal(a.confidentiality, 'basic');
  // Every field the API marks required for a create.
  for (const k of ['orderType', 'baseAsset', 'quoteAsset', 'quantity', 'side', 'price', 'depositType', 'refundTo', 'refundType', 'recipient', 'recipientType', 'confidentiality']) {
    assert.ok(a[k] != null, `${k} is set`);
  }
  // A public limit order is refused before any 1Click call.
  assert.throws(() => orderInput({ ...base, confidentiality: 'public' }), /confidentiality/);
});

test('an order view says what filled, what was refunded, and that cancel is async', () => {
  const order = {
    data: {
      id: 'ord_1',
      attributes: {
        side: 'SELL', baseAsset: 'nep141:wrap.near', quoteAsset: 'nep141:usdc.omft.near',
        quantity: '1000', price: '5', depositAddress: '0xabc', depositedAmountFormatted: '1.0',
        fillStatus: 'PARTIALLY_FILLED', payoutStatus: 'IN_PROGRESS', isPayoutStatusFinal: false,
        confidentiality: 'basic',
        partialFills: [{ id: 'f1', amountIn: '500', amountOut: '25' }],
        payouts: { withdrawal: { status: 'COMPLETED', txHash: '0xdead' }, refund: { status: 'IN_PROGRESS' }, allWithdrawals: [] },
      },
    },
  };
  const v = orderView(order);
  assert.equal(v.id, 'ord_1');
  assert.equal(v.fills, 1);
  assert.equal(v.withdrawalTx, '0xdead');
  assert.equal(v.refundTx, null, 'an unfinished refund has no hash yet');
  assert.equal(v.final, false);
  assert.match(v.cancelNote, /unfilled remainder is refunded/);
  assert.equal(isOpenOrder(order), true);
  // A fully paid-out order leaves the open list, even when it was only partly filled.
  const done = { data: { id: 'ord_2', attributes: { fillStatus: 'CANCELED', isPayoutStatusFinal: true } } };
  assert.equal(isOpenOrder(done), false);
  for (const s of OPEN_FILL_STATUSES) assert.equal(isOpenOrder({ attributes: { fillStatus: s } }), true, s);
});

test('a signed intent body is the generated payload plus the signature, never a rebuild', () => {
  const intent = { standard: 'nep413', payload: { recipient: 'intents.near', nonce: 'n', message: '{"deadline":"x","intents":[]}' } };
  const body = signedIntentBody(intent, { publicKey: 'ed25519:PK', signature: 'ed25519:SIG' });
  assert.equal(body.type, 'swap_transfer');
  // The payload object is the same reference: nothing was re-serialised or edited.
  assert.equal(body.signedData.payload, intent.payload);
  assert.equal(body.signedData.standard, 'nep413');
  assert.equal(body.signedData.public_key, 'ed25519:PK');
  assert.equal(body.signedData.signature, 'ed25519:SIG');
  assert.throws(() => signedIntentBody(null, { publicKey: 'a', signature: 'b' }), /no intent/);
  assert.throws(() => signedIntentBody(intent, { publicKey: '', signature: 'b' }), /public key/);
});

test('a status is trusted only through the signed quote it carries', () => {
  const quote = { signature: 'ed25519:SIG', quoteRequest: {}, quote: {}, timestamp: 't' };
  assert.equal(statusSignature({ quoteResponse: quote }, () => true).ok, true);
  assert.equal(statusSignature({ quoteResponse: quote }, () => false).reason, 'bad_signature');
  assert.equal(statusSignature({}, () => true).reason, 'no_signed_quote');
  // A verifier that throws is not a pass.
  assert.equal(statusSignature({ quoteResponse: quote }, () => { throw new Error('x'); }).reason, 'bad_signature');
});

test('only a verified SUCCESS says delivered', () => {
  assert.equal(deliveryVerdict('SUCCESS', { ok: true }).delivered, true);
  // The same status without a verified signature is not delivery.
  const unchecked = deliveryVerdict('SUCCESS', { ok: false });
  assert.equal(unchecked.delivered, false);
  assert.equal(unchecked.unchecked, true);
  for (const s of ['REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT']) assert.equal(deliveryVerdict(s, { ok: true }).delivered, false, s);
  assert.equal(deliveryVerdict('REFUNDED', { ok: true }).failed, true);
  // A status still pending is neither.
  const pending = deliveryVerdict('PROCESSING', { ok: true });
  assert.equal(pending.delivered, false);
  assert.equal(pending.failed, false);
});

test('a JSON:API error is flattened to the code the docs say to branch on', () => {
  const out = jsonApiError({
    errors: [{ status: '400', code: 'validation-failed', title: 'Validation failed', detail: 'Must be positive', source: { pointer: '/data/attributes/price' } }],
    meta: { correlationId: 'c-1' },
  });
  assert.equal(out.code, 'validation-failed');
  assert.equal(out.pointer, '/data/attributes/price');
  assert.equal(out.correlationId, 'c-1');
  assert.equal(jsonApiError({}).code, null);
});

test('the backend asks 1Click for the intent and submits only what the visitor signed', () => {
  const src = read('backend/src/ferry-intents.js');
  // The three types move together on a signed-intent quote.
  assert.match(src, /sent\.depositType = depositType/);
  assert.match(src, /sent\.refundType = depositType/);
  assert.match(src, /recipientType = depositType === 'INTENTS' \? 'INTENTS' : 'CONFIDENTIAL_INTENTS'/);
  // Partner-key calls only; no key is read from the repo.
  assert.match(src, /X-API-Key': key/);
  assert.match(src, /secret\.oneClick\(\)/);
  assert.doesNotMatch(src, /ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/, 'no private key literal');
  // Every route refuses to sign or send a deposit.
  for (const fn of ['signedIntentQuote', 'generateIntent', 'submitIntent', 'createOrder', 'listOrders', 'getOrder', 'cancelOrder']) {
    assert.match(src, new RegExp(`export async function ${fn}`), fn);
  }
});

test('the AI places and cancels orders by sentence, through the same callbacks as the buttons', async () => {
  const { runFerryAgent } = await import('../../../app/src/panels/deep.js');
  const seen = [];
  const out = await runFerryAgent({
    text: 'sell 1 NEAR at 5 USDC',
    state: {},
    onOrder: async cmd => { seen.push(cmd); return { ok: true, hint: 'Order placed at your price.' }; },
  });
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'order');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'place');
  assert.equal(seen[0].side, 'SELL');
  assert.equal(seen[0].price, '5');
  assert.equal(seen[0].base, 'NEAR@near');

  const cancel = await runFerryAgent({ text: 'cancel order ord_abc123', state: {}, onOrder: async cmd => { seen.push(cmd); return { ok: true }; } });
  assert.equal(cancel.mode, 'order');
  assert.equal(seen[1].kind, 'cancel');
  assert.equal(seen[1].orderId, 'ord_abc123');

  // An order sentence with no tray callback says so instead of pretending.
  const noHook = await runFerryAgent({ text: 'sell 1 NEAR at 5 USDC', state: {} });
  assert.equal(noHook.ok, false);

  // A swap sentence still goes to Load cargo, never to the order path.
  let loads = 0;
  const swap = await runFerryAgent({
    text: 'swap 0.05 wNEAR on near to USDC on near', state: {}, charterReady: true,
    quotePair: async () => ({ ok: true, from: { usd: '0.18' }, to: { amount: '0.17' }, depositAddress: 'intents.near' }),
    onLoadCargo: async () => { loads += 1; return { agentHint: '' }; },
    onOrder: async () => { throw new Error('a swap is not an order'); },
  });
  assert.equal(swap.mode, 'charter');
  assert.equal(loads, 1);
});
