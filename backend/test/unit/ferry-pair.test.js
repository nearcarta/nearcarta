import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toAsset, pairClauseId, isFerryClauseId, parsePairClauseId,
  parseAgentFerry, orderChipHtml, ORDER_STATES, chainLabel, ferryStampYocto,
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

test('city Ferry markup exposes Swap tabs + You pay/You get picker (agent dock is separate)', () => {
  const html = ferryMarkup({
    choices: [{ symbol: 'USDC', chain: 'base', id: 'USDC|base', label: 'USDC' }, { symbol: 'NEAR', chain: 'near', id: 'NEAR|near', label: 'NEAR' }],
    fromId: 'USDC|base',
    toId: 'NEAR|near',
    amt: '2',
  }, DEFAULT_ROUTES);
  assert.match(html, /data-testid="ferry-tabs"/);
  assert.match(html, /data-testid="ferry-tab-swap"/);
  assert.match(html, /data-testid="ferry-from"/);
  assert.match(html, /data-testid="ferry-to"/);
  assert.match(html, /You pay/);
  assert.match(html, /You get/);
  assert.match(html, /data-testid="ferry-quote"/);
  assert.match(html, /NEAR\|near/);
  assert.match(html, /data-testid="ferry-card"/);
});

test('quoted Ferry markup shows Load cargo and Ask charter CTAs', () => {
  const html = ferryMarkup({
    fromId: 'USDC|base', toId: 'ZEC|zec', amt: '3',
    q: { from: { symbol: 'USDC', amount: '3' }, to: { symbol: 'ZEC', amount: '0.002' } },
    charterReady: true,
  }, DEFAULT_ROUTES);
  assert.match(html, /data-testid="ferry-load-cargo"/);
  assert.match(html, /data-testid="ferry-ask-charter"/);
  assert.match(html, /data-testid="ferry-cargo-actions"/);
  assert.doesNotMatch(html, /ferry-cargo-actions"[^>]*hidden/);
  assert.equal(html.split('Ask charter · load cargo').length - 1, 1);
  assert.match(html, /data-testid="ferry-again"[^>]*hidden/);
});

test('after a ferry ask the card has one Get another quote and no second Ask charter', () => {
  const html = ferryMarkup({
    fromId: 'USDC|base', toId: 'ZEC|zec', amt: '3',
    q: { from: { symbol: 'USDC', amount: '3' }, to: { symbol: 'ZEC', amount: '0.002' } },
    charterReady: true,
    acted: true,
    charterNote: 'Charter refused the trip: the session key does not have enough gas allowance for this ask. The boat stays at the jetty.',
  }, DEFAULT_ROUTES);
  assert.match(html, /ferry-cargo-actions"[^>]*hidden/);
  assert.match(html, /data-testid="ferry-again"/);
  assert.doesNotMatch(html, /data-testid="ferry-again"[^>]*hidden/);
  assert.match(html, /Get another quote/);
  assert.match(html, /class="primary ferry-cta"/);
  assert.match(html, /data-testid="ferry-charter-note"/);
  assert.doesNotMatch(html, /account_id|NotEnoughAllowance/);
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
  assert.match(ui, /Load the cargo|Load cargo/);
  assert.match(ui, /Ask charter · load cargo/);
  assert.match(ui, /onLoadCargo|loadFerryCargo/);
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /ferry-load-cargo/);
  assert.match(deep, /ferry-ask-charter/);
  assert.match(deep, /refundForChain/);
  assert.match(ui, /applyPair/);
  assert.match(ui, /A\.ferry\(/);
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /isFerryClauseId/);
  assert.match(apps, /ferryClauseForPair/);
  assert.match(apps, /wanted/);
});

const yocto = n => (BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n).toString();
// Same fee as apps.js ferryNear: max(0.001, round(usd * 0.01 * 1000) / 1000).
const ferryNearOf = usd => Math.max(0.001, Math.round(Number(usd) * 0.01 * 1000) / 1000);

test('a board-path Ask charter stamp cannot exceed per_action_cap', () => {
  // Live row (Scholar, board.nearcarta.near): cap 0.005 NEAR, min 0.0001. A $3 quote is 0.03 NEAR.
  const cap = yocto(0.005);
  const min = yocto(0.0001);
  const raw = ferryNearOf(3);
  assert.equal(raw, 0.03);
  const stamp = ferryStampYocto(raw, { capYocto: cap, minYocto: min });
  assert.equal(stamp, cap);
  assert.ok(BigInt(stamp) <= BigInt(cap));
  assert.ok(BigInt(stamp) >= BigInt(min));
  // Under the cap, the fee stays (still at least the floor).
  assert.equal(ferryStampYocto(0.001, { capYocto: cap, minYocto: min }), yocto(0.001));
  // Floor lifts when it still fits inside the cap.
  assert.equal(ferryStampYocto(0.001, { capYocto: cap, minYocto: yocto(0.002) }), yocto(0.002));
  // A floor above the cap does not push the stamp over the cap.
  assert.equal(ferryStampYocto(0.03, { capYocto: yocto(0.001), minYocto: yocto(0.002) }), yocto(0.001));
  // No cap: the USD-scaled fee is unchanged (non-board path).
  assert.equal(ferryStampYocto(0.03, {}), yocto(0.03));
  for (const usd of [0.5, 1, 3, 10, 50]) {
    const fee = ferryNearOf(usd);
    const got = ferryStampYocto(fee, { capYocto: cap, minYocto: min });
    assert.ok(BigInt(got) <= BigInt(cap), `usd ${usd} stamp ${got} over cap`);
    assert.ok(BigInt(got) >= BigInt(min), `usd ${usd} stamp ${got} under min`);
  }
});

test('board Ask charter uses the clamped stamp and the payee allowlist (source)', () => {
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /function ferryAmountY\(q\)/);
  assert.match(apps, /if \(!S\.board\) return toY\(raw\)/);
  assert.match(apps, /ferryStampYocto\(raw, \{ capYocto: c\.per_action_cap \|\| null, minYocto: c\.min_amount \|\| null \}\)/);
  assert.match(apps, /amountY: ferryAmountY\(q\)/);
  // Payee fallback from d328b04 stays: route receivers, else pay, else the board row.
  assert.match(apps, /clauses\[route\]\?\.receivers \|\| S\.clauses\.pay\?\.receivers \|\| S\.boardRow\?\.receivers/);
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /extra\.charterNote = `Charter refused the trip:/);
  assert.match(ui, /function hideFerryPrimary/);
  assert.match(ui, /function ferryPlainReason/);
  assert.match(ui, /NotEnoughAllowance/);
  assert.doesNotMatch(ui, /btn\(APPS\.ferry\.btn\(\)\)/);
  const world = read('app/design/D9_world/world.css');
  assert.match(world, /body\.ferry-tray #shopUI #tray\{[\s\S]*overflow-x:hidden/);
  const css = read('app/src/panels/panels.css');
  assert.match(css, /overflow-wrap:anywhere/);
  const setup = read('app/house/setup.js');
  assert.match(setup, /DeleteKey/);
  assert.match(setup, /addKeyAction\(pk\)/);
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /data-testid="ferry-charter-note"/);
  assert.match(deep, /state\.charterNote/);
});

test('ferry tray shows the charter refusal inside the card', () => {
  const html = ferryMarkup({
    fromId: 'USDC|base', toId: 'ZEC|zec', amt: '3',
    q: { from: { symbol: 'USDC', amount: '3' }, to: { symbol: 'ZEC', amount: '0.002' } },
    charterReady: true,
    charterNote: 'Charter refused the trip: more than your max per payment. The boat stays at the jetty.',
  }, DEFAULT_ROUTES);
  assert.match(html, /data-testid="ferry-charter-note"/);
  assert.match(html, /more than your max per payment/);
  assert.match(html, /data-testid="ferry-ask-charter"/);
  const quiet = ferryMarkup({
    fromId: 'USDC|base', toId: 'ZEC|zec', amt: '3',
    q: { from: { symbol: 'USDC', amount: '3' }, to: { symbol: 'ZEC', amount: '0.002' } },
    charterReady: true,
  }, DEFAULT_ROUTES);
  assert.doesNotMatch(quiet, /ferry-charter-note/);
});

test('ferryPayee falls back to pay/board receivers on board sessions (source)', () => {
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /S\.clauses\.pay\?\.receivers/);
  assert.match(apps, /S\.boardRow\?\.receivers/);
  assert.match(apps, /ferryPayee = route =>/);
  // Must not only look at S.clauses[route] — board rows have no ferry route clauses.
  assert.match(apps, /clauses\[route\]\?\.receivers \|\| S\.clauses\.pay/);
  const session = read('shared/board/session.js');
  assert.match(session, /wrap\.near/);
  assert.match(session, /FERRY_CALL_TARGETS/);
  const css = read('app/src/panels/panels.css');
  assert.match(css, /ferry-cargo-actions\{display:grid;justify-items:center;gap:14px/);
  assert.match(css, /0 4px 0 #9a6f2e/); /* raised 3D CTA shelf */
  assert.match(css, /min-width:min\(220px/);
  assert.match(css, /\.ferry-cta\{[\s\S]*?\bwidth:auto/);
  assert.match(css, /justify-self:center/);
});
