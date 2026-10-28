import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ferryGuard, orchardOnly, echoGuard } from '../../src/ferry-guard.js';
import * as ferry from '../../src/ferry.js';
import { decodeUnifiedAddress, zcashRecipient } from '../../src/zcash.js';

const vectors = JSON.parse(readFileSync(new URL('../fixtures/zip316_vectors.json', import.meta.url)));
const fx = JSON.parse(readFileSync(new URL('../fixtures/quote-basic-usdc-zec.json', import.meta.url)));
const clone = o => JSON.parse(JSON.stringify(o));
const ua = want => vectors.find(v => JSON.stringify(v.expect) === JSON.stringify(want)).ua;
const rx = a => decodeUnifiedAddress(a).receivers;
const ORCHARD_ONLY = fx.sent.recipient;

test('the recorded live quote to an Orchard-only UA passes the guard', () => {
  assert.deepEqual(rx(ORCHARD_ONLY), ['Orchard']);
  const g = ferryGuard({ receivers: rx(ORCHARD_ONLY), sent: fx.sent, quoteRequest: fx.response.quoteRequest });
  assert.equal(g.ok, true, JSON.stringify(g.refused));
});

test('refused 1/4: Orchard + Sapling UA (ZIP 316 vector)', () => {
  const r = rx(ua(['Orchard', 'Sapling']));
  assert.equal(zcashRecipient(ua(['Orchard', 'Sapling'])).shielded, true, 'it is shielded, but not Orchard-only');
  const g = ferryGuard({ receivers: r });
  assert.equal(g.ok, false);
  assert.equal(g.refused[0].case, 'recipient_not_orchard_only');
  assert.match(g.refused[0].why, /Sapling/);
});

test('refused 2/4: Orchard + transparent UA (ZIP 316 vector)', () => {
  const g = ferryGuard({ receivers: rx(ua(['Orchard', 'P2PKH'])) });
  assert.equal(g.ok, false);
  assert.match(g.refused[0].why, /P2PKH/);
  assert.equal(orchardOnly(rx(ua(['Orchard', 'P2PKH', 'Sapling']))).ok, false);
});

test('refused 3/4: confidentiality basic echoed back as public', () => {
  const q = clone(fx.response.quoteRequest); delete q.confidentiality;
  const g = ferryGuard({ receivers: rx(ORCHARD_ONLY), sent: fx.sent, quoteRequest: q });
  assert.equal(g.ok, false);
  assert.deepEqual(g.refused.map(x => x.case), ['privacy_downgrade']);
  assert.deepEqual(g.refused[0].diffs[0], { field: 'confidentiality', sent: 'basic', got: 'public' });
});

test('refused 4/4: recipient swapped in the echo, even to another Orchard-only UA', () => {
  const q = clone(fx.response.quoteRequest); q.recipient = ua(['Orchard', 'Sapling']);
  const g = ferryGuard({ receivers: rx(ORCHARD_ONLY), sent: fx.sent, quoteRequest: q });
  assert.equal(g.ok, false);
  assert.deepEqual(g.refused.map(x => x.case), ['recipient_swap']);
  assert.equal(echoGuard(fx.sent, q).diffs[0].field, 'recipient');
});

test('ferry.js re-exports the same guard (one copy)', () => {
  assert.equal(ferry.echoGuard, echoGuard);
  assert.equal(ferry.orchardOnly, orchardOnly);
});

test('ferry.quote refuses a non-Orchard-only UA before asking 1Click', async () => {
  const real = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url));
    if (String(url).endsWith('/v0/tokens')) return new Response(JSON.stringify([
      { assetId: fx.sent.originAsset, symbol: 'USDC', blockchain: 'base', decimals: 6 },
      { assetId: fx.sent.destinationAsset, symbol: 'ZEC', blockchain: 'zec', decimals: 8 }]));
    throw new Error('1Click quote must not be called'); };
  try {
    for (const want of [['Orchard', 'Sapling'], ['Orchard', 'P2PKH']]) {
      const r = await ferry.quote({ from: { symbol: 'USDC', chain: 'base' }, to: { symbol: 'ZEC', chain: 'zec' }, amount: '2.5', recipient: ua(want), refundTo: fx.sent.refundTo, privacy: 'basic' });
      assert.equal(r.ok, false); assert.equal(r.refused, 'recipient_not_orchard_only'); assert.equal(r.zcash.orchard_only, false);
    }
    assert.ok(calls.every(u => u.endsWith('/v0/tokens')), calls.join(','));
  } finally { globalThis.fetch = real; }
});

test('the guard module has no imports, so the frontend can load it directly', () => {
  const src = readFileSync(new URL('../../src/ferry-guard.js', import.meta.url), 'utf8');
  assert.equal(/^\s*import\s/m.test(src), false);
});
