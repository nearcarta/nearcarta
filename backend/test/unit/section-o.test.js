import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PREVIEW_ROW } from '../../../app/src/panels/hall.js';
import { hallMarkup, shortId } from '../../../app/src/panels/hall-ui.js';
import { pageSigns } from '../../../app/src/panels/restore.js';
import { DEFAULT_ROUTES, ferryMarkup } from '../../../app/src/panels/deep.js';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const ROW = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';

test('a long row id shortens to the first six and last four characters', () => {
  assert.equal(shortId(ROW), '8e2027…61c8');
  assert.equal(shortId('preview.near'), 'preview.near');
  assert.equal(shortId('shop-moved-pay-here.near'), 'shop-moved-pay-here.near');
  const html = hallMarkup({ ...PREVIEW_ROW, owner: ROW }, { accountId: ROW, displayName: 'Scholar' });
  assert.match(html, /data-testid="hall-row-id"[^>]*>8e2027…61c8</);
  assert.match(html, new RegExp(`data-testid="hall-copy"[^>]*data-copy="${ROW}"`));
  assert.doesNotMatch(html, new RegExp(`<dd[^>]*>${ROW}</dd>`));
  assert.match(html, /class="check"/);
  assert.match(html, /class="field"/);
});

test('the restore banner is only for a page that signs', () => {
  assert.equal(pageSigns('hall'), true);
  assert.equal(pageSigns('townhall'), true);
  assert.equal(pageSigns('house'), true);
  assert.equal(pageSigns('vault'), true);
  for (const shop of ['guard', 'guardhouse', 'bank', 'mist', 'ferry', 'arena', 'toll', 'chronicle', 'payouts', '']) {
    assert.equal(pageSigns(shop), false, shop);
  }
  const boot = read('app/src/panels/boot.js');
  assert.match(boot, /if \(!pageSigns\(id\)\) return/);
});

test('guardhouse starts empty and offers the example as a button', () => {
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /data-testid="guard-example">Example: shop-moved-pay-here\.near/);
  assert.match(deep, /data-testid="guard-account" value="\$\{esc\(state\.acct \|\| ''\)\}"/);
  assert.doesNotMatch(deep, /guard-account" value="\$\{esc\(state\.acct \|\| 'shop-moved-pay-here\.near'\)\}"/);
});

test('ferry routes are brass cards and the arena box is tall', () => {
  const html = ferryMarkup({ ri: 0 }, DEFAULT_ROUTES);
  assert.match(html, /class="route-row"/);
  assert.match(html, /class="route-chip"[^>]*aria-pressed="true"/);
  assert.equal((html.match(/data-testid="ferry-route"/g) || []).length, 3);
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /class="attack-box" rows="6"/);
  assert.match(read('app/src/panels/bank-tray.js'), /class="beside"><input type="radio" name="note"/);
  const css = read('app/src/panels/panels.css');
  assert.match(css, /animation:routeShine/);
  assert.match(css, /gap:18px 12px/);
  assert.match(css, /min-height:140px/);
  assert.match(css, /body\[data-shop=payouts\]/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\)/);
});
