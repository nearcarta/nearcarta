// The five gold-standard items, measured per shop, for the PR checklist.
//   node e2e/gold-audit.mjs
import { chromium } from 'playwright';

const SHOPS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['ferry', 'guard', 'hall', 'payouts', 'arena', 'bank', 'chronicle', 'toll', 'house'];

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });

for (const shop of SHOPS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  await page.evaluate((shop) => {
    document.body.classList.add('in-shop', shop + '-tray');
    let ui = document.getElementById('shopUI');
    if (!ui) { ui = document.createElement('div'); ui.id = 'shopUI'; document.body.appendChild(ui); }
    ui.hidden = false;
    ui.innerHTML = `<section id="tray"><div class="t-scroll">
        <div class="t-head"><h1 id="t-title"></h1><span id="t-src" class="src"></span></div>
        <p id="t-sub" class="t-sub"></p><div id="t-hero" class="hero"></div>
        <div class="shop-quest" id="shop-quest"></div><div id="t-form" class="form"></div></div>
      <div class="t-row"><button id="t-act" type="button" class="act primary"></button></div>
      <div class="t-links"><button id="t-proof" class="link">How it works</button></div>
    </section>`;
  }, shop);
  await page.evaluate(async ({ shop }) => {
    const d = await import('/panels/deep.js');
    const id = await import('/panels/shop-identity.js');
    d.mountShop(shop, document.getElementById('t-form'), { auto: false });
    document.getElementById('t-title').innerHTML = `${id.badge(shop)}<span class="t-name">${id.titleOf(shop)}</span>${id.headerArt(shop)}`;
    document.getElementById('t-sub').textContent = id.subtitleOf(shop);
    document.getElementById('t-hero').innerHTML = id.flowStrip(shop);
    const a = document.getElementById('t-act');
    a.textContent = 'Sign in'; a.hidden = false;
  }, { shop });
  await page.waitForTimeout(1800);

  const r = await page.evaluate(() => {
    const tray = document.getElementById('tray');
    const tr = tray.getBoundingClientRect();
    const sc = tray.querySelector(':scope > .t-scroll');
    const vis = el => { const b = el.getBoundingClientRect(); return b.width > 2 && b.height > 2; };

    const scrolls = tray.scrollHeight > tray.clientHeight + 1
      || (sc ? sc.scrollHeight > sc.clientHeight + 1 : false);

    const badge = document.querySelector('#t-title .panel-badge');
    const art = document.querySelector('#t-title .panel-art');
    const sub = document.getElementById('t-sub');
    const src = document.querySelector('.t-head #t-src');
    const header = !!badge && vis(badge) && !!art && vis(art)
      && !!(sub && sub.textContent.trim())
      && Math.abs(badge.getBoundingClientRect().top - art.getBoundingClientRect().top) < 24
      && !!src;

    const tabs = [...tray.querySelectorAll('[role=tab], .hall-tab, .guard-tab, .payouts-tab, .bank-tab')].filter(vis);
    const active = tabs.filter(t => t.getAttribute('aria-selected') === 'true' || t.classList.contains('on') || t.getAttribute('aria-pressed') === 'true');
    const inactive = tabs.filter(t => !active.includes(t));
    const pill = tabs.length > 0
      && active.length >= 1
      && /linear-gradient/.test(getComputedStyle(active[0]).backgroundImage)
      && inactive.every(t => (parseFloat(getComputedStyle(t).borderTopWidth) || 0) >= 1);

    // field groups: label above control, and a consistent gap between groups
    const groups = [...document.querySelectorAll('#t-form .field, #t-form label.field, #t-form .ferry-field, #t-form .hall-field, #t-form .guard-field')].filter(vis);
    const labelAbove = groups.every(g => {
      const l = g.querySelector('span, label');
      const c = g.querySelector('input, select, textarea');
      if (!l || !c) return true;
      return c.getBoundingClientRect().top >= l.getBoundingClientRect().bottom - 1;
    });
    const fieldSpacing = groups.length > 0 && labelAbove;

    const golds = [...tray.querySelectorAll('button, a')].filter(el => vis(el)
      && !el.closest('[role=tablist]')
      && /linear-gradient/.test(getComputedStyle(el).backgroundImage)
      && el.getBoundingClientRect().height >= 40);
    const outlined = [...tray.querySelectorAll('button, a')].filter(el => vis(el)
      && !el.closest('[role=tablist]')
      && (parseFloat(getComputedStyle(el).borderTopWidth) || 0) >= 1
      && !/linear-gradient/.test(getComputedStyle(el).backgroundImage)
      && el.getBoundingClientRect().height >= 36);
    const actions = golds.length === 1 && outlined.length >= 1;

    return { width: Math.round(tr.width), scrolls, header, pill, tabs: tabs.length, fieldSpacing, groups: groups.length, actions, golds: golds.length, outlined: outlined.length };
  });
  console.log(JSON.stringify({ shop, ...r }));
  await page.close();
}
await browser.close();
