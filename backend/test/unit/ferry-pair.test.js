import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toAsset, pairClauseId, isFerryClauseId, parsePairClauseId,
  parseAgentFerry, orderChipHtml, ORDER_STATES, chainLabel,
} from '../../../app/src/panels/ferry-pair.js';
import { ferryMarkup, DEFAULT_ROUTES } from '../../../app/src/panels/deep.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('pairClauseId is stable for any 1Click pair (not only 3 corridors)', () => {
  assert.equal(pairClauseId('USDC@base', 'ZEC@zec'), 'route.usdc-base.zec-zec');
  assert.equal(pairClauseId('ETH@eth', 'NEAR@near'), 'route.eth-eth.near-near');
  assert.ok(isFerryClauseId('route.usdc-base.zec-zec'));
  assert.equal(isFerryClauseId('pay'), false);
  const p = parsePairClauseId('route.eth-eth.near-near');
  assert.equal(p.fromSym, 'ETH');
  assert.equal(p.toSym, 'NEAR');
});

test('toAsset and chainLabel normalize picker ids', () => {
  assert.equal(toAsset('USDC@base'), 'USDC@base');
  assert.equal(toAsset('eth|eth'), 'ETH@eth');
  assert.equal(toAsset('USDC on Base'), 'USDC@base');
  assert.equal(chainLabel('arb'), 'Arbitrum');
  assert.equal(chainLabel('zec'), 'Zcash');
});

test('parseAgentFerry fills from/to/amt from plain words', () => {
  const a = parseAgentFerry('Swap 3 USDC on Base to ZEC');
  assert.equal(a.amt, '3');
  assert.equal(a.from, 'USDC@base');
  assert.equal(a.to, 'ZEC@zec');
  assert.equal(a.fromId, 'USDC|base');
  const b = parseAgentFerry('ETH@eth → NEAR@near');
  assert.equal(b.from, 'ETH@eth');
  assert.equal(b.to, 'NEAR@near');
  assert.equal(parseAgentFerry('hello'), null);
});

test('order chip states match TOWN_PLAN ferry labels', () => {
  assert.ok(ORDER_STATES.jetty);
  assert.ok(ORDER_STATES.transit);
  assert.ok(ORDER_STATES.delivered);
  assert.ok(ORDER_STATES.refunded);
  assert.match(orderChipHtml('transit'), /data-testid="ferry-order-chip"/);
  assert.match(orderChipHtml('transit'), /in transit/);
  assert.match(orderChipHtml('delivered'), /far bank/);
});

test('city Ferry markup exposes agent chat + live dest from picker', () => {
  const html = ferryMarkup({
    choices: [{ symbol: 'USDC', chain: 'base', id: 'USDC|base', label: 'USDC' }, { symbol: 'NEAR', chain: 'near', id: 'NEAR|near', label: 'NEAR' }],
    fromId: 'USDC|base',
    toId: 'NEAR|near',
    amt: '2',
  }, DEFAULT_ROUTES);
  assert.match(html, /data-testid="ferry-agent"/);
  assert.match(html, /data-testid="ferry-agent-input"/);
  assert.match(html, /data-testid="ferry-agent-go"/);
  assert.match(html, /Tell the ferryman/);
  assert.match(html, /NEAR on near/);
  assert.match(html, /data-testid="ferry-picker"/);
});

test('city ferry room wires applyPair + order chip + speech beats (source)', () => {
  const src = read('app/design/D8_shops/shops/ferry.js');
  assert.match(src, /applyPair/);
  assert.match(src, /orderChipHtml/);
  assert.match(src, /paintOrder\('transit'\)/);
  assert.match(src, /paintOrder\('delivered'\)/);
  assert.match(src, /cargo\.fromSym/);
  assert.match(src, /speak\(/);
  assert.match(src, /refused/);
  assert.match(src, /Casting off/);
  assert.doesNotMatch(src, /swapsTo = \(\) => \{ tags\[0\]\.el\.innerHTML = icon\('ZEC'/);
});

test('rules sheet allows dynamic ferry pairs beyond 3 corridors (source)', () => {
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /data-testid="ferry-rules"/);
  assert.match(ui, /data-testid="ferry-rule-add"/);
  assert.match(ui, /pairClauseId/);
  assert.match(ui, /Load the cargo/);
  assert.match(ui, /Ask charter · load cargo/);
  assert.match(ui, /applyPair/);
  assert.match(ui, /A\.ferry\(/);
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /isFerryClauseId/);
  assert.match(apps, /ferryClauseForPair/);
  assert.match(apps, /wanted/);
});
