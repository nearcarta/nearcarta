// Every shop key reaches its tray in the city from ?shop= and from the All shops list.
// Before the fix five list entries had no city key, so Mist Bank and Vault Arena left the city for the
// standalone page, Toll needed a bespoke click handler, and a click during the boot called location.assign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const KEYS = ['ferry', 'payouts', 'bank', 'chronicle', 'guard', 'toll', 'house', 'arena', 'hall'];

const html = read('app/design/D9_world/index.html');
const list = html.slice(html.indexOf('data-testid="all-shops-list"'), html.indexOf('</ul>', html.indexOf('data-testid="all-shops-list"')));
const core = read('app/design/D9_world/js/core.js');
const main = read('app/design/D9_world/js/main.js');
const shopIds = [...core.matchAll(/^ {2}([a-z][a-z0-9]*):\s*\{\s*q:/gm)].map(m => m[1]);

test('the city has exactly the nine shops the router knows', () => {
  assert.deepEqual(shopIds.slice().sort(), [...KEYS].sort());
});

test('the All shops list has one entry per shop and no other shop link', () => {
  const entries = [...list.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].map(m => ({ href: m[1], attrs: m[2], text: m[3] }));
  const shopLinks = entries.filter(e => e.href !== '/shops/vault/');
  assert.equal(shopLinks.length, KEYS.length, 'one city entry per shop, plus the charter office');
});

for (const id of KEYS) {
  test(`the All shops entry for ${id} opens ${id} inside the city`, () => {
    const li = list.split('<li>').find(s => s.includes(`data-enter-shop="${id}"`) || s.includes(`data-city-shop="${id}"`));
    assert.ok(li, `no All shops entry carries the city key ${id}`);
    const href = li.match(/href="([^"]+)"/)?.[1];
    assert.equal(href, `/?shop=${id}`, `${id} must deep-link into the city, not a standalone page`);
  });
}

test('no All shops link leaves the city', () => {
  for (const m of list.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (href === '/shops/vault/') continue;
    assert.match(href, /^\/\?shop=(ferry|payouts|bank|chronicle|guard|toll|house|arena|hall)$/, `${href} leaves the city`);
  }
});

test('the nav script never falls back to a page load and has no per-shop handler', () => {
  const from = html.indexOf('function navOf');
  const nav = html.slice(from, html.indexOf('</script>', from));
  assert.doesNotMatch(nav, /location\.assign/, 'a click must never leave the city');
  assert.doesNotMatch(nav, /shops\/toll\//, 'Toll must use the shared city entry');
  assert.match(nav, /data-enter-shop|data-city-shop/, 'the list entries carry their city key');
  assert.match(nav, /__cityWant/, 'a click before the town boots must be held for the town');
});

test('main.js sends the deep link, the list and the public opener through one router', () => {
  assert.doesNotMatch(main, /const ALIAS=/, 'the alias map lives in city-route.js only');
  assert.match(main, /createRouter\(\{\s*open:id=>jump\(id\)\s*\}\)/);
  assert.match(main, /window\.__openCityShop = \(id\) => route\.open\(id\)/);
  assert.match(main, /shopQuery\(location\.search\)/);
  assert.match(main, /route\.arm\(\)/, 'the town must release a held request once it can open a room');
});
