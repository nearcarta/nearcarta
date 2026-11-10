// Render ONE shop panel at native size, without the 3D room, and crop it.
//
//   node e2e/panel-native.mjs ferry [1440]
//
// The city page builds the room first and only then paints the panel, so on a machine where the
// 3D room cannot start (no GPU, or the quote API is unreachable) the panel never appears — even
// though the panel code is fine. This mounts the panel on the real town page in a bare host, so
// the thing under review can be looked at and measured on its own.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const shop = process.argv[2] || 'ferry';
const W = Number(process.argv[3] || 1440);
const OUT = process.env.OUT || '/tmp/panels-native';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: W === 390 ? 844 : 900 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

await page.evaluate((shop) => {
  document.body.classList.add('in-shop', shop + '-tray');
  let ui = document.getElementById('shopUI');
  if (!ui) { ui = document.createElement('div'); ui.id = 'shopUI'; document.body.appendChild(ui); }
  ui.hidden = false;
  ui.innerHTML = `<section id="tray"><div class="t-scroll">
      <div class="t-head"><h1 id="t-title"></h1><span id="t-src" class="src"></span></div>
      <p id="t-sub" class="t-sub"></p><p id="t-label" class="label"></p>
      <div id="t-hero" class="hero"></div><div id="shop-quest" class="shop-quest"></div>
      <div id="t-form" class="form"></div></div>
    <div class="t-row"><button id="t-act" type="button" class="act primary"></button></div>
    <p id="t-rcpt" class="rcpt"></p>
    <div class="t-links"><a id="t-more" class="link" hidden></a><button id="t-rules" class="link" hidden>Your rules</button><button id="t-proof" class="link">How it works</button></div>
  </section>`;
}, shop);

const info = await page.evaluate(async ({ shop }) => {
  const deep = await import('/panels/deep.js');
  const id = await import('/panels/shop-identity.js');
  const form = document.getElementById('t-form');
  deep.mountShop(shop, form, { auto: false });
  document.getElementById('t-title').innerHTML = `${id.badge(shop)}<span class="t-name">${id.titleOf(shop)}</span>${id.headerArt(shop)}`;
  document.getElementById('t-sub').textContent = id.subtitleOf(shop);
  document.getElementById('t-hero').innerHTML = id.flowStrip(shop);
  const act = document.getElementById('t-act');
  act.textContent = 'Sign in'; act.hidden = false;
  await new Promise(r => setTimeout(r, 400));
  const tray = document.getElementById('tray').getBoundingClientRect();
  return { w: Math.round(tray.width), h: Math.round(tray.height) };
}, { shop });

await page.waitForTimeout(300);
const clip = await page.evaluate(() => {
  const r = document.getElementById('tray').getBoundingClientRect();
  return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
});
await page.screenshot({ path: `${OUT}/${shop}-${W}.png`, clip });
console.log(JSON.stringify({ shop, W, panel: info, out: `${OUT}/${shop}-${W}.png` }));
await browser.close();
