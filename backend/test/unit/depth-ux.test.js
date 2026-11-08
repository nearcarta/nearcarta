import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shapeCore, shapeClauses, shapeActions, shapeBank } from '../../../app/src/live/shape.js';
import { roomError, showsRawEngineText } from '../../../app/src/room-error.js';
import { INTRO_MIN_MS, introEnabled, introLine } from '../../../app/design/D9_world/js/intro-plan.js';
import { beginEnter, finishEnter } from '../../../app/design/D9_world/js/room-lock.js';
import { payoutReady, payoutLabel } from '../../../app/design/D8_shops/js/payout-ready.js';
import { tokenChoices, chainsOf, filterTokens, quoteView, compareRows, statusView } from '../../../app/src/ferry-catalog.js';
import { policyView } from '../../../app/src/policy-view.js';
import { decide, recordedRefusal } from '../../../backend/src/counterparty.js';

const read = p => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('a deployments payload with no guardhouse keeps the sample code hash', () => {
  const sample = { codeHash: 'sample-hash', oath: 'sample.near', receiver: 'payee.near' };
  // The board is the oath now: the snapshot comes from board.nearcarta.near and the
  // config from /api/board/config. No retired charter account takes part.
  const board = { board: 'board.nearcarta.near', config: { contract: 'board.nearcarta.near', owner: 'nearcarta.near', rows: 0, max_row_yocto: '20000000000000000000000' } };
  const core = shapeCore({ board: { contract: 'board.nearcarta.near' } }, { state: { owner: 'owner.near', frozen: false }, oath: 'board.nearcarta.near', source: 'board' }, board, sample);
  assert.equal(core.codeHash, 'sample-hash');
  assert.equal(core.oath, 'board.nearcarta.near');
  assert.equal(core.owner, 'nearcarta.near');
  assert.equal(core.rows, 0);
  assert.equal(core.src, 'mainnet');
  // No guardhouse and no board config: the caller's sample stands untouched.
  assert.equal(shapeCore({ board: {} }, {}, null, sample), sample);
  // A board snapshot has no clauses, so the sample's retired charter clauses are not shown.
  assert.deepEqual(shapeClauses({ clauses: null, source: 'board' }, ['stale-charter']), []);
  // A factory charter still has clauses and keeps them.
  assert.deepEqual(shapeClauses({ clauses: null }, ['keep']), ['keep']);
  assert.deepEqual(shapeClauses({}, ['keep']), ['keep']);
});

test('a chronicle row with no result value does not throw', () => {
  const rows = shapeActions({ txs: [{ method: 'propose', result: { ok: true }, at: '2026-11-05T00:00:00Z' }] }, ['sample']);
  assert.deepEqual(rows, ['sample']);
  assert.equal(shapeBank({ built: true }), null);
  assert.equal(shapeBank({ built: true, payout: {}, street: {}, oath: {} }).street.txid, undefined);
});

test('a room error never shows the engine text', () => {
  const msg = roomError(new TypeError("Cannot read properties of undefined (reading 'code_hash')"));
  assert.equal(showsRawEngineText(msg), false);
  assert.match(msg, /could not load/);
  assert.match(roomError(new Error('http 500')), /busy/);
});

test('the town intro plays for a fresh visit and skips when asked', () => {
  assert.equal(INTRO_MIN_MS >= 20000, true);
  assert.equal(introEnabled(''), true);
  assert.equal(introEnabled('?nostory'), false);
  assert.equal(introEnabled('?explore'), false);
  assert.equal(introEnabled('?shop=ferry'), false);
  assert.equal(introLine(0).length > 0, true);
  assert.match(read('app/design/D9_world/js/main.js'), /dataset\.intro='camera'/);
  assert.match(read('app/design/D9_world/js/main.js'), /run\(story\(\)\)/);
  assert.match(read('app/design/D9_world/js/fb.js'), /mountIntro/);
});

test('a second shop pin during the door transition is ignored', () => {
  const first = beginEnter({ busy: false, id: null }, 'ferry');
  assert.equal(first.id, 'ferry');
  assert.equal(first.ignored, null);
  const second = beginEnter(first, 'hall');
  assert.equal(second.ignored, 'hall');
  assert.equal(second.id, 'ferry');
  assert.equal(finishEnter(first).busy, false);
  assert.match(read('app/design/D9_world/js/fb.js'), /beginEnter/);
});

test('pay is disabled when the payout total is zero', () => {
  assert.equal(payoutReady([{ to: 'a.near', amt: '0' }]).enabled, false);
  assert.equal(payoutLabel([{ to: 'a.near', amt: '0' }]), 'Pay');
  const ready = payoutReady([{ to: 'a.near', amt: '0.001' }, { to: 'b.near', amt: '0.001' }], null, 0.005);
  assert.equal(ready.enabled, true);
  assert.equal(ready.count, 2);
  // The cap is the visitor's own /setup cap, never a constant in the shop.
  assert.equal(payoutReady([{ to: 'a.near', amt: '0.006' }], null, 0.005).enabled, false);
  assert.equal(payoutReady([{ to: 'a.near', amt: '0.006' }], null, 0.02).enabled, true);
  assert.equal(payoutReady([{ to: 'a.near', amt: '0.001' }]).enabled, false, 'an unread cap pays nothing');
  assert.match(read('app/design/D8_shops/js/shopui.js'), /payoutReady/);
  assert.doesNotMatch(read('app/design/D8_shops/js/shopui.js'), /Sending (it )?to Base|cross to Base|Pays on Base/);
});

test('back to town sits above the title card', () => {
  const css = read('app/src/brand/brown.css');
  // The property is "above the chrome", not one particular number. It was 60; it is 210 now
  // because the tray's own z-index is 200 and the pill has to stay reachable over it.
  const m = css.match(/#shopUI #back[\s\S]*?z-index:\s*(\d+)/);
  assert.ok(m, 'the block sets a z-index');
  assert.ok(Number(m[1]) >= 60, `z-index ${m[1]} must clear the title card and the tray`);
  assert.match(css, /position:\s*fixed !important/);
  assert.match(css, /min-width:\s*44px/);
  // The shape has to be stated in this block too, because it wins with !important; otherwise
  // the old gradient and 4px shadow leak through and the pill looks pasted on.
  assert.match(css, /border-radius:\s*999px !important/);
  assert.match(css, /background:\s*rgba\(26,\s*20,\s*15/);
  assert.match(read('app/design/D9_world/js/shops.js'), /roomError/);
  const town = read('app/design/D9_world/index.html');
  assert.match(town, /aria-label="Sound off"/);
  assert.match(town, /aria-pressed="false"/);
  assert.match(town, /id="curfewHint"/);
  assert.match(read('app/shops/vault/main.js'), /Array\.isArray/);
  assert.match(read('app/src/judges-data.js'), /71Zio28g/);
});

test('the charter agent key is named as propose and propose_batch', () => {
  for (const file of ['app/src/console.js', 'app/src/judges-data.js', 'app/design/D6_dashboards/src/shops/Guardhouse.jsx', 'README.md']) {
    const text = read(file);
    assert.match(text, /propose/);
    assert.match(text, /propose_batch/);
  }
  const ui = ['app/shops/vault/main.js', 'app/house/setup.js', 'app/design/D9_world/js/core.js', 'app/src/console.js'].map(read).join('\n');
  assert.doesNotMatch(ui, /can only call <code>propose<\/code>|propose-only/);
});

test('popular assets lead the ferry picker', () => {
  const rows = [
    { symbol: 'USDe', blockchain: 'hood' },
    { symbol: 'ZEC', blockchain: 'sol' },
    { symbol: 'USDC', blockchain: 'base' },
    { symbol: 'ETH', blockchain: 'eth' },
    { symbol: 'BTC', blockchain: 'btc' },
    { symbol: 'SOL', blockchain: 'sol' },
    { symbol: 'NEAR', blockchain: 'near' },
    { symbol: 'USDC', blockchain: 'arb' },
    { symbol: 'USDC', blockchain: 'pol' },
    { symbol: 'wNEAR', blockchain: 'near' },
  ];
  assert.deepEqual(tokenChoices(rows).map(t => t.id).slice(0, 8), [
    'USDC|base', 'USDC|arb', 'USDC|pol', 'ETH|eth', 'BTC|btc', 'SOL|sol', 'NEAR|near', 'wNEAR|near',
  ]);
  const css = read('app/design/D8_shops/styles.css');
  assert.match(css, /#tray \.token-listbox-menu/);
  assert.match(css, /max-height:\s*min\(240px,\s*42vh\)/);
  assert.match(css, /overflow:\s*auto/);
  assert.match(css, /token-listbox-menu\[hidden\]/);
  const brown = read('app/src/brand/brown.css');
  assert.match(brown, /body:has\(article#card\) header\.top/);
  assert.match(brown, /position:\s*static/);
  const world = read('app/design/D9_world/world.css');
  assert.match(world, /#shopUI \.token-listbox-menu/);
  assert.match(world, /max-height:\s*min\(240px,\s*42vh\)/);
});

test('the pay page lists a long token catalog and every terminal status', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ symbol: 'T' + i, blockchain: i % 2 ? 'near' : 'base', decimals: 6, price: 1 }));
  const choices = tokenChoices(rows);
  assert.ok(choices.length >= 50);
  assert.ok(chainsOf(choices).includes('near'));
  assert.equal(filterTokens(choices, { q: 't1', chain: 'near' }).every(t => t.chain === 'near'), true);
  const view = quoteView({ to: { amount: '1.2', symbol: 'USDC' }, eta_s: 40, cost_bps_signed: 12, usd: '0.20', privacy: 'basic', dry: true });
  assert.equal(view.amountOut, '1.2');
  assert.equal(view.dry, true);
  assert.equal(compareRows([view, null]).length, 1);
  for (const status of ['PENDING_DEPOSIT', 'SUCCESS', 'REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT']) {
    const s = statusView({ status, help: status, tx: 'abc' });
    assert.equal(s.status, status);
  }
  assert.equal(statusView({ status: 'REFUNDED' }).refund, true);
  assert.equal(statusView({ status: 'INCOMPLETE_DEPOSIT' }).refund, true);
  assert.equal(statusView({ status: 'SUCCESS' }).terminal, true);
  assert.match(read('app/src/ferry-pay.js'), /\/api\/ferry\/tokens/);
  assert.match(read('app/src/ferry-pay.js'), /You send the tokens yourself/);
  // No product-wide USD cap: the visitor's row is the limit.
  assert.doesNotMatch(read('app/src/ferry-pay.js'), /0\.20 USD/);
  assert.match(read('app/src/ferry-pay.js'), /Your row sets the limit/);
});

test('the guardhouse policy card names both methods and a recorded scam payee is blocked', () => {
  const view = policyView({
    state: { frozen: true, sealed: true },
    clauses: { pay: { receivers: ['cafe.near'], per_action_cap: '1000000000000000000000000', daily_budget: '2000000000000000000000000', max_actions_per_day: 4, window_start_min: 0, window_end_min: 0 } },
    methods: ['propose', 'propose_batch'],
  });
  assert.deepEqual(view.agentMethods, ['propose', 'propose_batch']);
  assert.equal(view.frozen, true);
  assert.equal(view.sealed, true);
  assert.equal(view.agentCannotUnfreeze, true);
  assert.equal(view.allowlist[0], 'cafe.near');
  assert.equal(view.perActionNear, 1);
  const hit = recordedRefusal('shop-moved-pay-here.near');
  assert.ok(hit.evidence[0]);
  const verdict = decide({ exists: true, deny: hit, allowlisted: false, prior_payments: 0, age_ms: null, code_changed_ms: null, lookalike_of: null });
  assert.equal(verdict.verdict, 'block');
  assert.equal(verdict.reasons.some(r => r.code === 'denylisted'), true);
});
