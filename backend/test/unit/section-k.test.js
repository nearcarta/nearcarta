import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hallRowHref, nextPath, sessionPill, signedCopy } from '../../../app/design/D8_shops/js/session.js';
import { rowOwner } from '../../../app/shops/hall/row.js';
import { decide, check } from '../../src/counterparty.js';
import { quoteLine } from '../../../app/src/ferry-catalog.js';
import { chronicleRowsFromMainnet, chronicleSummary, FERRY_BUTTON, FERRY_PASS, PRIVACY, renderJudges } from '../../../app/src/judges-data.js';
import { formatNear, payoutIssues } from '../../../app/design/D8_shops/js/payouts.js';
import { payoutReady } from '../../../app/design/D8_shops/js/payout-ready.js';
import { downloadCsv, queryFeed, verifyEntry } from '../../../app/src/chronicle-feed.js';
import { txVerdict } from '../../../shared/net/tx-verdict.js';
import { tryTiles } from '../../../shared/setup/try-tiles.js';
import { nearAccountOk } from '../../../shared/net/accounts.js';
import { RUN_LABEL, NEXT_LABEL } from '../../../app/design/D8_shops/shops/arena-labels.js';
import { otherNet, otherEvm, retiredNet } from '../../../shared/net/word-scan.js';

const EMPTY = '11111111111111111111111111111111';

test('one session pill and a return path that drops the preview flag', () => {
  const id = 'abcdef1234567890abcdef1234567890.near';
  assert.equal(sessionPill({ accountId: id, displayName: 'Scholar', balanceNear: 0 }), 'Scholar · abcdef…near · Fund');
  assert.equal(sessionPill({ accountId: id, displayName: 'Scholar', balanceNear: '1.2' }), 'Scholar · abcdef…near · 1.2 NEAR');
  assert.equal(signedCopy('visitor.near', false).sub.includes('Sign in when'), false);
  assert.equal(nextPath('?next=%2Fshops%2Fhall%2F%3Fpreview%3D1'), '/shops/hall/');
  assert.equal(nextPath('?next=https://evil.example'), null);
  assert.equal(hallRowHref('visitor.near'), '/shops/hall/?owner=visitor.near');
  assert.equal(hallRowHref(''), '/setup/?next=%2Fshops%2Fhall%2F');
  assert.equal(rowOwner({ preview: true }).owner, 'preview.near');
  assert.equal(rowOwner({ owner: 'visitor.near', session: 'other.near' }).owner, 'visitor.near');
  assert.equal(rowOwner({ session: 'preview.near' }).owner, null);
});

test('a missing age or an empty code hash is a caution', () => {
  const open = decide({ exists: true, allowlisted: true, prior_payments: 1, age_ms: 3_600_000, code_hash: 'abc', index: 'ok' });
  assert.equal(open.verdict, 'allow');
  const missing = decide({ exists: true, allowlisted: true, prior_payments: 1, age_ms: null, code_hash: EMPTY, index: 'unavailable: down' });
  assert.equal(missing.verdict, 'warn');
  assert.ok(missing.reasons.some(r => r.code === 'age_unknown'));
  assert.ok(missing.reasons.some(r => r.code === 'unconfirmed'));
});

test('an allowlisted payee with no age from the index is not allowed', async () => {
  const view = async (acct, method, args) => {
    if (method === 'get_clauses') return { pay: { receivers: ['bakery.shop.near'] } };
    if (method === 'get_state') return { next_action: '1', prune_cursor: '0' };
    if (method === 'get_action') return { receiver: 'bakery.shop.near', status: 'confirmed' };
    throw new Error('unexpected ' + method);
  };
  const r = await check('bakery.shop.near', {
    now: Date.parse('2026-10-28T20:00:00Z'),
    viewAccount: async () => ({ code_hash: EMPTY }),
    view,
    fpost: async () => { throw new Error('index down'); },
    charter: 'c.near',
  });
  assert.notEqual(r.verdict, 'allow');
});

test('a ferry line names both tokens, the dollars, the fee and the wait', () => {
  const line = quoteLine({
    from: { amount: '0.002', symbol: 'ETH', chain: 'eth', usd: '6' },
    to: { amount: '0.04', symbol: 'ZEC', chain: 'zec' },
    eta_s: 90,
    cost_bps_signed: 12,
    usd: '6',
  });
  assert.match(line.text, /0\.002 ETH on eth/);
  assert.match(line.text, /0\.04 ZEC on zec/);
  assert.match(line.text, /\$6/);
  assert.match(line.text, /fee 12 bps/);
  assert.match(line.text, /90s/);
  const src = readFileSync(new URL('../../../app/design/D8_shops/js/apps.js', import.meta.url), 'utf8');
  assert.match(src, /ROUTES\.length > 3/);
  assert.match(readFileSync(new URL('../../../app/design/D8_shops/js/shopui.js', import.meta.url), 'utf8'), /data-testid="ferry-route"/);
});

test('the judges page and the console share one script', () => {
  const rows = chronicleRowsFromMainnet({
    board: {
      txs: { 'allowed_0.001': 'a', refused_over_per_action_cap: 'b', refused_receiver_not_allowlisted: 'c' },
      visitor_run: { txs: { 'propose_allowed_0.001': 'd', 'propose_refused_0.01_over_per_action_cap': 'e' } },
    },
  });
  assert.equal(rows.length, 5);
  assert.equal(chronicleSummary(rows), '2 allowed payments and 3 refusals');
  const html = renderJudges(rows);
  assert.match(html, new RegExp(FERRY_BUTTON));
  assert.equal(FERRY_PASS.length, 3);
  assert.ok(PRIVACY.some(p => p.value === 'basic' && /confidential/.test(p.label)));
  assert.match(html, /2 allowed payments and 3 refusals/);
  assert.doesNotMatch(html, /one allowed payment and two refusals/);
  assert.match(readFileSync(new URL('../../../app/src/console.js', import.meta.url), 'utf8'), /chronicleSummary/);
});

test('a payout rejects a bad name, a missing account and a row over 0.005', () => {
  assert.equal(nearAccountOk('bad account!'), false);
  assert.equal(nearAccountOk('cafe.near'), true);
  assert.equal(formatNear(0.001), '0.001');
  assert.equal(payoutReady([{ to: 'bad account!', amt: '0.001' }]).enabled, false);
  assert.equal(payoutReady([{ to: 'cafe.near', amt: '0.5' }]).enabled, false);
  assert.equal(payoutReady([{ to: 'cafe.near', amt: '0.001' }], { 'cafe.near': false }).enabled, false);
  assert.equal(payoutReady([{ to: 'cafe.near', amt: '0.001' }]).enabled, true);
  assert.ok(payoutIssues([{ to: 'bad account!', amt: '0.5' }]).length >= 2);
});

test('a chronicle verify without a chain status is not a pass, and export can download', () => {
  const rows = [{ shop: 'toll', decision: 'allowed', reason: 'over the cap', label: 'more than your max per payment', h: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz' }];
  assert.equal(queryFeed(rows, { q: 'more than your max' }).total, 1);
  assert.equal(queryFeed(rows, { q: 'no-such-word' }).total, 0);
  assert.equal(verifyEntry(rows[0]).ok, false);
  assert.equal(verifyEntry(rows[0], { pass: true }).ok, true);
  assert.equal(txVerdict({ status: { SuccessValue: 'ok' } }).pass, true);
  assert.equal(txVerdict({}).pass, false);
  assert.equal(downloadCsv('shop,decision\n', 'chronicle.csv', {}).downloaded, false);
});

test('arena buttons say which action can spend, and a used quota does not say tap to run', () => {
  assert.match(RUN_LABEL, /spends if the charter allows/);
  assert.match(NEXT_LABEL, /does not spend/);
  const none = tryTiles({ actionsToday: 3, maxPerDay: 3 });
  assert.equal(none.allowDisabled, true);
  assert.doesNotMatch(none.allowAction, /Tap to run/);
  assert.match(none.allowAction, /0 of 3 left today/);
  const some = tryTiles({ actionsToday: 0, maxPerDay: 3 });
  assert.match(some.allowAction, /Tap to run/);
});

test('the intro clock exists before the cast build, and a slow software GPU stays in 3D', () => {
  const src = readFileSync(new URL('../../../app/design/D9_world/js/main.js', import.meta.url), 'utf8');
  const decl = src.indexOf('let storyT0=0');
  const boot = src.indexOf('await buildCast()');
  assert.ok(decl > -1 && decl < boot);
  assert.match(src, /!window\.__gl\?\.soft/);
});

test('visitor titles do not name the old network', () => {
  const files = [
    'app/src/console.html', 'app/src/judges.html', 'app/src/console.js',
    'app/shops/hall/index.html', 'app/shops/payouts/index.html', 'app/design/D9_world/index.html',
  ];
  for (const f of files) {
    const text = readFileSync(new URL('../../../' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(text, new RegExp('\\(' + otherNet.source + '\\)', 'i'), f);
    assert.doesNotMatch(text, otherEvm, f);
  }
  assert.match(readFileSync(new URL('../../../app/src/console.js', import.meta.url), 'utf8'), /Nearcarta · for judges/);
});
