import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toUnits, buildQuoteRequest, echoGuard, checkQuote, signedCostBps } from '../../src/ferry.js';

const fx = JSON.parse(readFileSync(new URL('../fixtures/quote-basic-usdc-zec.json', import.meta.url)));
const clone = o => JSON.parse(JSON.stringify(o));

test('toUnits converts decimals exactly', () => {
  assert.equal(toUnits('2.5', 6), '2500000');
  assert.equal(toUnits('1', 24), '1' + '0'.repeat(24));
  assert.equal(toUnits('0.000001', 6), '1');
  assert.throws(() => toUnits('0.0000001', 6));
  assert.throws(() => toUnits('-1', 6));
  assert.throws(() => toUnits('1e3', 6));
});

test('requests are always dry and carry the privacy level only when asked', () => {
  const from = { assetId: 'a', decimals: 6 }, to = { assetId: 'b', decimals: 8 };
  const pub = buildQuoteRequest({ from, to, amount: '1', recipient: 'r', refundTo: 'f' });
  assert.equal(pub.dry, true);
  assert.equal('confidentiality' in pub, false);
  assert.equal(buildQuoteRequest({ from, to, amount: '1', recipient: 'r', refundTo: 'f', privacy: 'basic' }).confidentiality, 'basic');
  assert.throws(() => buildQuoteRequest({ from, to, amount: '1', recipient: 'r', refundTo: 'f', privacy: 'secret' }));
});

test('recorded live quote: signature valid, echo matches, accepted', () => {
  const c = checkQuote(fx.sent, fx.response);
  assert.equal(c.signature, true);
  assert.equal(c.echo.ok, true);
  assert.equal(c.accepted, true);
  assert.ok(c.echo.protocolFeeBps <= 20);
});

test('tampering a signed field (amountOut) breaks the signature', () => {
  const r = clone(fx.response); r.quote.amountOut = String(BigInt(r.quote.amountOut) + 1n);
  assert.equal(checkQuote(fx.sent, r).signature, false);
});

test('silent privacy downgrade keeps a valid signature but the echo guard rejects it', () => {
  const r = clone(fx.response); delete r.quoteRequest.confidentiality;
  const c = checkQuote(fx.sent, r);
  assert.equal(c.signature, true, 'confidentiality is not covered by the signature');
  assert.equal(c.echo.ok, false);
  assert.equal(c.accepted, false);
  assert.equal(c.echo.diffs[0].field, 'confidentiality');
});

test('an injected app fee over the protocol cap is rejected even though the signature verifies', () => {
  const r = clone(fx.response); r.quoteRequest.appFees = [...(r.quoteRequest.appFees || []), { recipient: 'attacker.near', fee: 480 }];
  const c = checkQuote(fx.sent, r);
  assert.equal(c.signature, true);
  assert.equal(c.accepted, false);
});

test('our own fee must come back unchanged', () => {
  const sent = { ...fx.sent, appFees: [{ recipient: 'shop.near', fee: 10 }] };
  const q = { ...fx.response.quoteRequest, appFees: [{ recipient: 'shop.near', fee: 10 }, { recipient: 'x', fee: 20 }] };
  assert.equal(echoGuard(sent, q).ok, true);
  q.appFees[0].fee = 5;
  assert.equal(echoGuard(sent, q).ok, false);
});

test('a quote with a deposit address is not dry and is refused', () => {
  const r = clone(fx.response); r.quote.depositAddress = '0xdead';
  assert.equal(checkQuote(fx.sent, r).accepted, false);
});

test('cost is computed from signed USD fields', () => {
  assert.equal(signedCostBps({ amountInUsd: '100', amountOutUsd: '99' }), 100);
  assert.equal(signedCostBps({ amountInUsd: '0', amountOutUsd: '0' }), null);
});
