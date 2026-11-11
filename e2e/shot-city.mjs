// Screenshot a few city shops quickly for a visual check while iterating.
//   node e2e/shot-city.mjs ferry guard hall [--mobile]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || '/tmp/shots-now';
const shops = process.argv.slice(2).filter(a => !a.startsWith('--'));
const sizes = process.env.MOBILE ? [[390, 844]] : [[1440, 900], [390, 844]];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
for (const [W, H] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  for (const shop of shops) {
    try {
      await page.goto(`${BASE}/design/D9_world/?shop=${shop}`, { waitUntil: 'domcontentloaded' });
      await page.locator('#t-proof').waitFor({ state: 'visible', timeout: 60000 });
      await page.waitForTimeout(3500);
      await page.locator('#t-proof').click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/${shop}-${W}.png` });
      // Measure the panel: does it scroll, overflow, and are its controls tall enough?
      const m = await page.evaluate(() => {
        const tray = document.querySelector('#shopUI #tray');
        if (!tray) return { error: 'no tray' };
        const scroll = tray.querySelector('.t-scroll');
        const small = [...tray.querySelectorAll('button, input, select, textarea, a[href]')]
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
          .map(el => ({ tag: el.tagName, id: el.id || el.dataset.testid || el.className, h: Math.round(el.getBoundingClientRect().height) }))
          .filter(x => x.h < 40);
        return {
          tray: { w: Math.round(tray.getBoundingClientRect().width), h: Math.round(tray.getBoundingClientRect().height) },
          trayScroll: tray.scrollHeight > tray.clientHeight + 1,
          innerScroll: scroll ? scroll.scrollHeight > scroll.clientHeight + 1 : null,
          sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          smallControls: small.slice(0, 5),
          smallCount: small.length,
        };
      });
      console.log(shop, W, JSON.stringify(m));
    } catch (e) {
      console.log(shop, W, 'ERR', String(e.message).slice(0, 100));
    }
  }
  await ctx.close();
}
await browser.close();
