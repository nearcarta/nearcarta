import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const shops = process.argv.slice(2).length ? process.argv.slice(2) : ['ferry','payouts','toll','arena','guard'];
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
for (const shop of shops) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${BASE}/design/D9_world/?shop=${shop}`, { waitUntil: 'domcontentloaded' });
  await p.locator('#t-proof').waitFor({ state: 'visible', timeout: 90000 });
  await p.waitForTimeout(2500);
  const r = await p.evaluate(() => {
    const t = document.getElementById('t-title');
    const tray = document.querySelector('#shopUI #tray');
    const act = document.getElementById('t-act');
    const golds = [...tray.querySelectorAll('button, a')].filter(el => {
      const cs = getComputedStyle(el); const bb = el.getBoundingClientRect();
      return bb.width > 2 && bb.height > 2 && /linear-gradient/.test(cs.backgroundImage) && bb.height >= 40;
    }).map(el => ({ id: el.id || el.dataset.testid || el.className.slice(0, 24), h: Math.round(el.getBoundingClientRect().height) }));
    return {
      titleHTML: t ? t.innerHTML.slice(0, 130) : null,
      hasBadge: !!t?.querySelector('.panel-badge'),
      actText: act ? act.textContent : null,
      actHidden: act ? act.hidden : null,
      actGold: act ? /linear-gradient/.test(getComputedStyle(act).backgroundImage) : null,
      golds,
      scroll: (() => { const sc = tray.querySelector(':scope > .t-scroll'); return sc ? sc.scrollHeight - sc.clientHeight : null; })(),
    };
  });
  console.log(shop, JSON.stringify(r));
  await p.close();
}
await b.close();
