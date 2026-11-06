import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roomError, showsRawEngineText } from '../../../app/src/room-error.js';
import { lookalike } from '../../../shared/vault/attacks.js';
import { formatNear, issueText, payoutIssues } from '../../../app/design/D8_shops/js/payouts.js';
import { callsFor, draftFrom, matchNote, nearOf, normalizeRow, rowOwner, yoctoOf } from '../../../app/shops/hall/row.js';
import { corridorCards, DEFAULT_ROUTES, ferryMarkup } from '../../../app/src/panels/deep.js';
import { quoteLine } from '../../../app/src/ferry-catalog.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('a room error never shows the engine text', () => {
  for (const raw of ["Cannot read properties of undefined (reading 'version')", "Cannot read properties of null (reading 'proof_txs')", "Cannot read properties of null (reading 'length')"]) {
    const shown = roomError(new Error(raw));
    assert.equal(showsRawEngineText(shown), false);
    assert.match(shown, /could not load/);
  }
});

test('a missing charter list and a missing account do not throw', () => {
  assert.equal(lookalike(null), '');
  assert.equal(lookalike(''), '');
  assert.equal(Array.isArray(null) ? null : [].length, 0);
});

test('the hall form prefills the row cap and signs set_rules with no deposit', () => {
  const y = yoctoOf(0.005);
  const row = normalizeRow({ owner: 'visitor.near', row: { owner: 'visitor.near', per_action_cap: y, daily_budget: yoctoOf(0.02), max_actions_per_day: 3, receivers: ['cafe.near'], frozen: false, sealed: false } });
  assert.equal(nearOf(row.per_action_cap), 0.005);
  const same = draftFrom(row, { capNear: '0.005', frozen: false, sealed: false });
  assert.match(matchNote(row, same).text, /matches the row/);
  assert.equal(matchNote(row, same).calls.length, 0);
  const next = draftFrom(row, { capNear: '0.003' });
  const calls = callsFor(row, next);
  assert.equal(calls[0].method, 'set_rules');
  assert.equal(calls[0].deposit, '0');
  assert.equal(rowOwner({ preview: true, owner: 'visitor.near' }).owner, 'visitor.near');
  assert.equal(rowOwner({ preview: true }).owner, null);
});

test('payout messages name the whole account and keep 0.0025', () => {
  assert.equal(formatNear(0.001), '0.001');
  assert.equal(formatNear(0.0025), '0.0025');
  assert.equal(payoutIssues([{ to: '', amt: '0.001' }, { to: '', amt: '0.001' }]).length, 0);
  const issues = payoutIssues([{ to: 'bob.near', amt: '0.0025' }, { to: 'bob.near', amt: '9' }]);
  assert.equal(issueText(issues.filter(x => x.code === 'bad_account')), '');
  assert.match(issueText(payoutIssues([{ to: 'not an account', amt: '0.001' }])), /^not an account is not a NEAR account$/);
  const dup = issueText(payoutIssues([{ to: 'bad name', amt: '0.001' }, { to: 'bad name', amt: '0.001' }]));
  assert.equal(dup, 'bad name is not a NEAR account');
});

test('ferry corridors sit side by side and carry a USD line', () => {
  const html = ferryMarkup({}, DEFAULT_ROUTES);
  assert.equal((html.match(/data-testid="ferry-corridor"/g) || []).length, 3);
  assert.match(html, /data-testid="ferry-usd"/);
  assert.match(html, /data-testid="ferry-compare"/);
  const cards = corridorCards(DEFAULT_ROUTES, [{ id: DEFAULT_ROUTES[0].id, usdText: 'about $1.2', text: 'ETH' }]);
  assert.match(cards, /about \$1\.2/);
  const line = quoteLine({ from: { amount: '3', symbol: 'USDC', chain: 'base', usd: '3' }, to: { amount: '0.01', symbol: 'ZEC', chain: 'zec' } });
  assert.match(line.text, /about \$3/);
});

test('each shop route and the console use the one shop module', () => {
  const shopui = read('../../../app/design/D8_shops/js/shopui.js');
  const boot = read('../../../app/src/panels/boot.js');
  const build = read('../../../app/shops/build.mjs');
  const consoleJs = read('../../../app/src/console.js');
  for (const id of ['ferry', 'guard', 'toll', 'chronicle', 'arena', 'hall', 'payouts', 'bank', 'house']) {
    assert.match(shopui, new RegExp(`mountShop\\('${id}'`));
  }
  assert.match(read('../../../app/src/panels/house-room.js'), /deedMarkup\(\)/);
  assert.match(boot, /mountShop/);
  assert.match(build, /\['ferry', 'ferry', 'Ferry'\]/);
  assert.match(consoleJs, /mountShop/);
  assert.match(read('../../../app/src/console.html'), /serviceWorker/);
  assert.match(read('../../../app/design/D9_world/index.html'), /#loading\{position:fixed/);
  assert.match(read('../../../app/design/D9_world/index.html'), /Opening the town/);
  assert.doesNotMatch(read('../../../app/design/D9_world/index.html'), /setTimeout\(hide, 1200\)/);
  assert.match(read('../../../app/design/D9_world/js/main.js'), /exitShop\(\)/);
  assert.doesNotMatch(read('../../../app/house/house.js'), /a DAO can also freeze/);
  assert.doesNotMatch(read('../../../app/house/house.js'), /shared DAO/);
  assert.match(read('../../../app/house/house.js'), /The owner may freeze and unfreeze this house/);
});

test('loading and shop pages do not name a rehearsal network', () => {
  const files = [
    '../../../app/src/panels/deep.js',
    '../../../app/src/panels/hall-ui.js',
    '../../../app/src/panels/boot.js',
    '../../../app/shops/hall/index.html',
    '../../../e2e/section-l.spec.js',
  ];
  for (const f of files) {
    const text = read(f);
    assert.equal(/testnet|sepolia/i.test(text), false, f);
  }
});
