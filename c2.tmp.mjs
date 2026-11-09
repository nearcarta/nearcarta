// Open every shop in the real city (?shop=<id>) and measure the panel.
// Run: node /tmp/measure-shops.mjs [baseUrl] [width] [height]
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:5173';
const W = Number(process.argv[3] || 1440), H = Number(process.argv[4] || 900);
const SHOPS = ['ferry', 'toll', 'guard', 'bank', 'hall', 'arena', 'payouts', 'house', 'chronicle'];

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });

for (const id of SHOPS) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  try {
    await page.goto(`${base}/design/D9_world/?shop=${id}&mode=2d`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tray', { timeout: 30000 }).catch(() => null);
    await page.waitForFunction(() => {
      const t = document.querySelector('#t-title');
      return t && t.textContent.trim() && !/Loading|Opening/i.test(document.querySelector('#t-label')?.textContent || '');
    }, { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(900);

    const m = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      const tray = q('#tray'); if (!tray) return { err: 'no tray' };
      const r = tray.getBoundingClientRect();
      const head = q('#tray > .t-scroll > .t-head');
      const scroll = q('#tray > .t-scroll');
      const tabs = q('#tray [role=tablist]');
      const act = q('#t-act');
      const ctrls = [...tray.querySelectorAll('input,select,textarea,button,a')].filter(e => e.offsetParent !== null && !e.hidden);
      const h = e => Math.round(e.getBoundingClientRect().height);
      const small = ctrls.filter(e => h(e) > 0 && h(e) < 36).map(e => ((e.id || e.className || e.tagName) + '').slice(0, 22) + ':' + h(e));
      const outside = ctrls.filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1); }).map(e => ((e.id || e.className) + '').slice(0, 20));
      const clipped = [...tray.querySelectorAll('*')].filter(e => {
        const s = getComputedStyle(e);
        return e.scrollWidth > e.clientWidth + 2 && s.overflowX === 'hidden' && e.clientWidth > 0;
      }).length;
      return {
        w: Math.round(r.width), h: Math.round(r.height),
        right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
        radius: getComputedStyle(tray).borderTopLeftRadius,
        headShown: !!head && getComputedStyle(head).display !== 'none',
        headText: head ? head.textContent.trim().replace(/\s+/g, ' ').slice(0, 46) : '',
        label: (q('#t-label')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 54),
        hasTabs: !!tabs, tabs: tabs ? tabs.textContent.trim().replace(/\s+/g, ' ').slice(0, 44) : '',
        scroll: scroll ? { s: scroll.scrollHeight, c: scroll.clientHeight } : null,
        act: act && !act.hidden ? { t: act.textContent.trim().slice(0, 26), h: h(act) } : null,
        trayOverflow: tray.scrollHeight > tray.clientHeight + 2,
        small, outside, clipped,
        vw: innerWidth, vh: innerHeight,
      };
    });

    if (m.err) { console.log(id.padEnd(10), m.err); continue; }
    console.log(id.padEnd(10),
      `${W}x${H}`,
      `box ${m.w}x${m.h}`,
      `r=${m.radius}`,
      m.headShown ? 'HEAD' : 'head-NONE',
      m.hasTabs ? 'tabs' : '----',
      m.scroll && m.scroll.s > m.scroll.c + 2 ? `scroll ${m.scroll.s}/${m.scroll.c}` : 'fits',
      m.act ? `cta ${m.act.h}` : 'cta -',
      m.trayOverflow ? 'TRAY-OVER' : '',
      m.clipped ? `clip${m.clipped}` : '',
      m.small.length ? `SMALL ${m.small.join(' ')}` : '',
      m.outside.length ? `OUT ${m.outside.join(' ')}` : '',
      errs.length ? `ERR ${errs[0]}` : '');
    if (process.env.VERBOSE) console.log('   ', JSON.stringify(m.headText), '|', JSON.stringify(m.label), '|', JSON.stringify(m.tabs));
  } finally { await page.close(); }
}
await browser.close();
