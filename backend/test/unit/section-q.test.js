import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveTee, teeTimeoutWhy, TEE_PLAN } from '../../../app/src/tee-view.js';
import { hallMarkup } from '../../../app/src/panels/hall-ui.js';
import { nearOf, PREVIEW_ROW } from '../../../app/src/panels/hall.js';
import { deedMarkup } from '../../../app/src/panels/deed.js';
import { houseCharterMarkup } from '../../../app/src/panels/deep.js';
import { makeApp } from '../../src/app.js';
import { DEP } from '../../src/config.js';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const ROW = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('a TEE check names each step and times out with a reason', async () => {
  assert.equal(TEE_PLAN[0][0], 'request');
  assert.match(teeTimeoutWhy(8000), /8 seconds/);
  assert.match(teeTimeoutWhy(8000), /Nothing was signed/);
  const out = await liveTee({
    nonce: 'ab'.repeat(32),
    timeoutMs: 40,
    fetchImpl: () => new Promise(() => {}),
  });
  assert.equal(out.ok, false);
  assert.equal(out.steps[0].id, 'request');
  assert.match(out.failure, /40 milliseconds/);
  assert.match(out.failure, /about 2 seconds/);
  assert.match(out.failure, /Nothing was signed/);
  const boot = read('app/src/panels/boot.js');
  assert.match(boot, /pageSigns\(id\) \? resolveAccount\(\)/);
  assert.match(boot, /if \(!saved\.signedIn && pageSigns\(id\)\) await accountP/);
  assert.match(boot, /if \(!pageSigns\(id\)\) return/);
  const tray = read('app/src/panels/bank-tray.js');
  assert.match(tray, /Asking NEAR AI/);
  assert.doesNotMatch(tray, /Checking the TEE/);
  assert.doesNotMatch(read('app/src/panels/deep.js'), /Checking the TEE/);
});

test('the hall cap is the on-chain amount and the copy control is under the id', () => {
  assert.equal(nearOf('4000000000000000000000'), 0.004);
  const html = hallMarkup({ ...PREVIEW_ROW, owner: ROW, per_action_cap: '4000000000000000000000' }, { accountId: ROW, displayName: 'Scholar' });
  assert.match(html, /data-testid="hall-cap"[^>]*value="0\.004"/);
  assert.match(html, /data-testid="hall-row-full">8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8</);
  assert.match(html, /data-testid="hall-row-id"[^>]*>8e2027…61c8</);
  const css = read('app/src/panels/panels.css');
  assert.match(css, /\.hall-meta div:has\(> dd\.row-id\)\{display:flex;flex-direction:column/);
  assert.match(css, /\[data-testid=hall-row-full\]\{color:#fff8ee;font-size:16px/);
});

test('the house deed links are brass and a missing oath is not a missing row', async () => {
  const deed = deedMarkup();
  assert.match(deed, /class="primary deed-link" data-testid="deed-mint"/);
  assert.match(deed, /class="primary deed-link" data-testid="deed-allow"/);
  assert.match(deed, /class="primary deed-link" data-testid="deed-refuse"/);
  assert.match(deed, /class="deed-actions"/);
  const row = houseCharterMarkup({ accountId: ROW, row: { owner: ROW, per_action_cap: '4000000000000000000000' } });
  assert.match(row, /data-testid="house-cap">0\.004</);
  assert.match(row, /Town Hall/);
  assert.doesNotMatch(row, /did not return a row/);
  const empty = houseCharterMarkup({ accountId: ROW });
  assert.match(empty, /data-testid="charter-cta"/);
  assert.match(empty, /data-testid="charter-setup" href="\/setup\/#rules"/);
  assert.match(empty, /Rules and Sign/);
  assert.match(empty, /no charter row/);
  assert.match(empty, /Nothing was signed/);
  assert.doesNotMatch(empty, /data-testid="hall-cap"|id="cap"/);
  assert.equal(DEP.extras?.house?.contract, 'house.nearcarta.near');
  assert.equal(DEP.extras?.house?.oath, undefined);
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('rpc should not run'); };
  const res = await makeApp().request('/api/house');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.kind, 'deed');
  assert.equal(body.contract, 'house.nearcarta.near');
  assert.equal(called, false);
  const toll = read('app/src/panels/toll-room.js');
  assert.match(toll, /class="ferry-cta" id="toll-pay" data-testid="toll-pay"/);
  assert.match(toll, /class="toll-quiet" id="toll-sig" data-testid="check-signature"/);
});

test('the locked rules card says why, and the home page lists the shops', () => {
  const vault = read('app/shops/vault/main.js');
  const html = read('app/shops/vault/index.html');
  const css = read('app/shops/vault/vault.css');
  assert.match(html, /data-testid="rules-lock"/);
  assert.match(vault, /no factory charter/);
  assert.match(vault, /Town Hall/);
  assert.match(css, /#rules-lock\{font-size:16px/);
  assert.doesNotMatch(css, /#s-rules\{opacity:\.55\}/);
  const home = read('app/design/D9_world/index.html');
  assert.match(home, /data-testid="all-shops"/);
  assert.match(home, /data-testid="all-shops-link">All shops</);
  for (const href of ['/shops/bank/', '/shops/hall/', '/?shop=ferry', '/shops/guard/', '/shops/arena/', '/shops/toll/', '/?shop=chronicle', '/shops/house/', '/shops/payouts/', '/shops/vault/']) {
    assert.match(home, new RegExp('href="' + href.replace(/[?]/g, '\\?') + '"'));
  }
  assert.match(home, /data-city-shop="ferry"/);
  assert.match(home, /data-city-shop="chronicle"/);
  assert.match(home, /__openCityShop/);
  assert.match(home, /details\.open = false/);
  const town = read('app/design/D9_world/js/main.js');
  assert.match(town, /window\.__openCityShop = \(id\) => jump\(id\)/);
  assert.match(town, /P\.get\('shop'\)/);
  const fb = read('app/design/D9_world/js/fb.js');
  assert.match(fb, /window\.__openCityShop = \(id\) => \{ open\(id\); \}/);
  assert.match(fb, /open\(start\)/);
  const world = read('app/design/D9_world/world.css');
  assert.match(world, /nav\.all-shops\{position:fixed/);
  assert.doesNotMatch(world, /#c\{[^}]*all-shops/);
});
