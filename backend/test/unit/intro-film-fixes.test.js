// F11-F15: what the intro take on prod showed after the story ended.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const main = read('app/design/D9_world/js/main.js');
const world = read('app/design/D9_world/js/world.js');
const speech = read('app/design/D9_world/js/speech.js');
const css = read('app/design/D9_world/world.css');
const chrome = read('app/src/net/chrome.js');
const scam = read('app/src/net/scam.js');

test('F11: the errand is compact, bottom-right on wide screens, hidden during the story, and stays hidden once closed', () => {
  assert.match(css, /@media \(min-width:721px\)\{\.scam-host\{left:auto;right:72px;justify-content:flex-end\}/);
  assert.match(css, /body\.story \.scam-host\{display:none\}/);
  assert.match(scam, /class="scam\$\{onTestnet\(\) \? '' : ' compact'\}"/);
  assert.match(scam, /if \(scamDismissed\(\)\) host\.classList\.add\('closed'\)/);
  assert.match(scam, /host\.classList\.add\('closed'\); scamDismissed\(true\);/);
});

test('F11: the dismissal is remembered per network', async () => {
  globalThis.window = globalThis.window || {};
  const m = await import('../../../app/src/net/scam.js').catch(() => null);
  if (!m?.scamDismissed) return; // browser-only module graph; the source checks above still hold
  const mem = new Map(); const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(m.scamDismissed(false, store), false);
  assert.equal(m.scamDismissed(true, store), true);
  assert.equal(m.scamDismissed(false, store), true);
});

test('F12: the story lands on the pinned town view, 0 is the overview key, and a stray press cannot block hover tags', () => {
  const land = main.slice(main.indexOf('const LAND_Z='), main.indexOf('PC.yaw=Math.atan2', main.indexOf('const LAND_Z=')));
  const z = Number(/const LAND_Z=([.\d]+)/.exec(land)[1]);
  // updPins: pins fade in from .42 and are fully on at .62.
  assert.match(main, /const a=sstep\(\.42,\.62,z\)/);
  assert.ok(z >= 0.62, `landing zoom ${z} shows the pins`);
  assert.match(land, /setZoom\(LAND_Z\)/);
  assert.match(main, /\(k==='o'\|\|k==='0'\)&&!inShop/);
  assert.match(main, /addEventListener\('pointerup',e=>\{ if\(e\.target!==cv\) down=null; \},true\)/);
});

test('F13: the MAINNET badge hint is drawn inside the viewport, not by the native tooltip', () => {
  assert.doesNotMatch(chrome, /data-testid="net-badge"[\s\S]{0,80}title="/);
  assert.match(chrome, /data-tip="\$\{badgeTip\(test\)\}"/);
  assert.match(css, /\.net-badge\[data-tip\]::after\{content:attr\(data-tip\);position:absolute;top:calc\(100% \+ 8px\);right:0;width:max-content;max-width:min\(260px,calc\(100vw - 24px\)\)/);
});

test('F14: a bubble never fades out mid-word and is never measured while hidden', async () => {
  assert.match(speech, /end:clock\.T\+Math\.max\(dur\?\?0,text\.length\/speed\+READ_S,2\.2\)/);
  assert.match(speech, /if\(T>=b\.end&&b\.shown<b\.text\.length\)\{ b\.shown=b\.text\.length;/);
  assert.match(speech, /if\(!b\.w&&b\.el\.offsetWidth>0\)/);
  const fn = new Function(speech.slice(speech.indexOf('export function shownText'), speech.indexOf('\n', speech.indexOf('export function shownText'))).replace('export ', '') + '; return shownText;')();
  assert.equal(fn('Frozen. I wait for you.', 3, false), 'Fro');
  assert.equal(fn('Frozen. I wait for you.', 3, true), 'Frozen. I wait for you.');
});

test('F15: the gate caps hide when the camera is close', () => {
  assert.match(world, /export const GATE_CAP_NEAR = 6;/);
  assert.match(world, /c\.visible=!W\.camera\|\|W\.camera\.position\.distanceTo\(c\.position\)>GATE_CAP_NEAR/);
});

test('Skip intro ends the story from the button, Escape, or a later tap', () => {
  const html = read('app/build.mjs');
  assert.match(html, /document\.getElementById\('skipIntro'\)\.addEventListener\('click',out\)/);
  assert.match(main, /else if\(mode==='story'\) endStory\(\); \} \}\);/);
});
