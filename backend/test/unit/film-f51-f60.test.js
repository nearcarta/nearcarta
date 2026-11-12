// Film take 2026-11-12 on prod 715f1e11 (fresh testnet guest): F51-F60.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const city = read('app/src/market/city.js');

// The failure helpers are pure; evaluate them out of city.js without loading the 3D town.
const helpers = (() => {
  const a = city.indexOf('const FAIL_TEXT = {');
  const b = city.indexOf('// One pill a judge cannot miss');
  const src = city.slice(a, b).replace(/export const /g, 'const ');
  return new Function(`${src}; return { failureCode, failureText };`)();
})();

test('F51: a refusal is one human sentence, never raw chain JSON', () => {
  const raw = '{"ActionError":{"index":0,"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: ERR_FLOAT"}}}}';
  assert.equal(helpers.failureCode(raw), 'ERR_FLOAT');
  assert.doesNotMatch(helpers.failureText(raw), /[{}"]/);
  assert.match(helpers.failureText(raw), /float/);
  assert.match(helpers.failureText('ERR_PRECHECK_STORAGE'), /Press again/);
  assert.match(helpers.failureText('{"weird":1}'), /^The chain refused this step\. Nothing was spent\.$/);
  assert.doesNotMatch(city, /The MPC signature did not come back this time: \$\{esc\(String/);
});

test('F52: strip errors that are bare codes are said in words', () => {
  assert.match(city, /text: WHY\[e\.code\] \|\| \(failureCode\(e\.code \|\| e\.message\) \? failureText/);
});

test('F53: a guest reads the real purse and the live Arena quote; the end banner says what the purse holds', () => {
  assert.match(city, /GT\.coins\(\)/);
  assert.match(city, /liveQuote \* 3n/);
  assert.match(city, /your purse holds \$\{coins\(realPurse\)\} coins/);
  const lg = read('app/src/market/live-guest.js');
  assert.match(lg, /export async function saltQuote/);
});

test('F54: the purse shows the number to its owner, with the seal explained', () => {
  assert.doesNotMatch(city, /sealed \? '••••'/);
  assert.match(city, /This number is shown only to you/);
});

test('F55/F58: Market Day walks are fast and capped in real seconds', () => {
  assert.match(city, /walkTo\?\.\(s\.shop, \{ fast: true, max: 4 \}\)/);
  const main = read('app/design/D9_world/js/main.js');
  assert.match(main, /if\(opt\.max>0\) setTimeout\(/);
});

test('F56: the strip stays up while the shop closes', () => {
  assert.match(city, /leaving = true; try \{ await WD\(\)\.exitShop/);
  assert.match(city, /function paintStrip\(\) \{\n  if \(leaving\) return;/);
});

test('F57: "more below" only when something really scrolls', () => {
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /\/\(auto\|scroll\)\/\.test\(getComputedStyle\(el\)\.overflowY\)/);
});

test('F59: receipt titles wrap; a step result replaces its running line', () => {
  assert.match(read('app/src/market/market.css'), /\.md-row\.static \.md-nm b \{ white-space: normal/);
  assert.match(read('app/src/net/scam.js'), /if \(prev\) prev\.replaceWith\(row\); else receipts\.append\(row\);/);
});

test('F60: a testnet guest sees an outlined "Play for real", not a gold "Sign in"', () => {
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /else if \(!id && testnetGuest\(\)\) btn\('Play for real', 'ghost'\);/);
  assert.match(read('app/src/panels/shop-shell.css'), /#t-act\.ghost:not\(\[hidden\]\)/);
});
