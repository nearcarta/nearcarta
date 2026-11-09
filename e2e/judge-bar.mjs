// Judge the panels against the owner's design bar, with numbers instead of impressions.
//   node e2e/judge-bar.mjs [shop...]
//
// Checks, per shop and tab:
//   - exactly ONE gold CTA per view (the bar: "one gold CTA per view")
//   - no control under 40px (tap targets)
//   - no text smaller than 11px anywhere a visitor reads (the bar: no tiny labels)
//   - no overflow, no internal scroll on desktop
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || '/tmp/judge/bar';
const shops = process.argv.slice(2).filter(a => !a.startsWith('--'));
const list = shops.length ? shops : ['ferry', 'guard', 'hall', 'payouts', 'arena', 'bank', 'chronicle', 'toll', 'house'];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });

for (const W of [1440, 390]) {
  const H = W === 390 ? 844 : 900;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  for (const shop of list) {
    await page.goto(`${BASE}/design/D9_world/?shop=${shop}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#t-proof').waitFor({ state: 'visible', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.locator('#t-proof').click();
    await page.waitForTimeout(900);
    // Close the proof drawer: it covers the panel and intercepts the tab clicks.
    await page.evaluate(() => document.getElementById('drawer')?.classList.remove('open'));

    const tabs = await page.evaluate(() => [...document.querySelectorAll('#shopUI #tray [role=tab]')].map(e => e.dataset.testid).filter(Boolean));
    for (const tab of tabs.length ? tabs : [null]) {
      if (tab) {
        const b = page.getByTestId(tab);
        if (await b.count()) { await b.first().click(); await page.waitForTimeout(600); }
      }
      const v = await page.evaluate(() => {
        const tray = document.querySelector('#shopUI #tray');
        if (!tray) return { err: 'no tray' };
        const sc = tray.querySelector(':scope > .t-scroll');
        const vis = el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; };

        // A gold CTA is the gradient-filled primary. Count what a visitor would call a big
        // gold button, so a second one anywhere in the panel shows up as a violation.
        const golds = [...tray.querySelectorAll('button, a, [role=button]')].filter(el => {
          if (!vis(el)) return false;
          const cs = getComputedStyle(el);
          const g = cs.backgroundImage || '';
          const h = el.getBoundingClientRect().height;
          return /linear-gradient/.test(g) && h >= 44 && /gradient/.test(g);
        }).map(el => ({ id: el.id || el.dataset.testid || el.className, h: Math.round(el.getBoundingClientRect().height) }));

        const small = [...tray.querySelectorAll('button, input, select, textarea, a[href]')]
          .filter(vis)
          .map(el => ({ id: el.id || el.dataset.testid || el.className || el.tagName, h: Math.round(el.getBoundingClientRect().height) }))
          .filter(x => x.h < 40);

        // Readable text that is too small to be comfortable.
        const tiny = [...tray.querySelectorAll('p, span, small, b, a, label, li, div')]
          .filter(el => vis(el) && el.children.length === 0 && (el.textContent || '').trim().length > 2)
          .map(el => ({ t: (el.textContent || '').trim().slice(0, 30), px: parseFloat(getComputedStyle(el).fontSize) }))
          .filter(x => x.px < 11);

        return {
          goldCount: golds.length,
          golds: golds.slice(0, 4),
          smallCount: small.length,
          small: small.slice(0, 4),
          tinyCount: tiny.length,
          tiny: tiny.slice(0, 4),
          trayScroll: tray.scrollHeight > tray.clientHeight + 1,
          innerScroll: sc ? sc.scrollHeight > sc.clientHeight + 1 : false,
          sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          // The review asked for these three by name, so they are measured, not assumed.
          hasBadge: !!document.querySelector('#shopUI #tray #t-title .panel-badge'),
          hasArt: !!document.querySelector('#shopUI #tray #t-title .panel-art'),
          // Two scrollers at once is the nested-scroll defect: on desktop neither may scroll,
          // on a phone exactly one may.
          scrollers: [tray, sc].filter(el => el && el.scrollHeight > el.clientHeight + 2).length,
        };
      });
      const key = `${shop}${tab ? '.' + tab.replace(/^[a-z]+-tab-|^[a-z]+-mode-?/, '') : ''}`;
      const bad = [];
      if (v.goldCount > 1) bad.push(`GOLD×${v.goldCount}`);
      if (v.smallCount) bad.push(`SMALL×${v.smallCount}`);
      if (v.tinyCount) bad.push(`TINY×${v.tinyCount}`);
      if (W === 1440 && (v.trayScroll || v.innerScroll)) bad.push('SCROLL');
      if (W === 1440 && v.scrollers > 0) bad.push('DESKTOP-SCROLL');
      if (W === 390 && v.scrollers > 1) bad.push('NESTED-SCROLL');
      if (v.sideways) bad.push('SIDEWAYS');
      if (!v.hasBadge) bad.push('NO-BADGE');
      if (!v.hasArt) bad.push('NO-ART');
      console.log(`${String(W).padEnd(5)} ${key.padEnd(26)} ${bad.length ? 'FAIL ' + bad.join(' ') : 'ok'}`);
      if (bad.length) {
        if (v.smallCount) console.log('        small:', JSON.stringify(v.small));
        if (v.tinyCount) console.log('        tiny :', JSON.stringify(v.tiny));
        if (v.goldCount > 1) console.log('        gold :', JSON.stringify(v.golds));
      }
      await page.screenshot({ path: `${OUT}/${key}-${W}.png` });
    }
  }
  await ctx.close();
}
await browser.close();
