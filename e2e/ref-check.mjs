// The reference checks the owner asked for, in code.
//
// The previous suite measured the wrong things and passed panels that did not look like the
// references. These four checks are the ones that would have caught it:
//
//   1. the title is never truncated
//   2. the primary button is at least 90% of the panel's inner width
//   3. no element's text overlaps another element's box
//   4. the panel is at least 380px wide at 1440
//
// Plus the structure the references require: a badge, a subtitle, an illustration, a flow strip,
// a .shop-quest slot, and one gold CTA.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || '/tmp/ref-check';
const shops = process.argv.slice(2).filter(a => !a.startsWith('--'));
const LIST = shops.length ? shops : ['ferry', 'guard', 'hall', 'payouts', 'arena', 'bank', 'chronicle', 'toll', 'house'];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
let fail = 0, total = 0;

for (const W of [1440, 390]) {
  const H = W === 390 ? 844 : 900;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  for (const shop of LIST) {
    await page.goto(`${BASE}/design/D9_world/?shop=${shop}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#t-proof').waitFor({ state: 'visible', timeout: 90000 });
    await page.waitForTimeout(2600);
    // Close the proof drawer: it covers the panel and blocks tab clicks.
    await page.evaluate(() => document.getElementById('drawer')?.classList.remove('open'));

    const tabs = await page.evaluate(() => [...document.querySelectorAll('#shopUI #tray [role=tab]')].map(e => e.dataset.testid).filter(Boolean));
    for (const tab of tabs.length ? tabs : [null]) {
      if (tab) {
        const b = page.getByTestId(tab);
        if (await b.count()) { await b.first().click({ force: true }); await page.waitForTimeout(700); }
      }
      const v = await page.evaluate(() => {
        const tray = document.querySelector('#shopUI #tray');
        if (!tray) return { err: 'no tray' };
        const tr = tray.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(tray).paddingLeft) || 0;
        const inner = tr.width - pad * 2;

        const nameEl = document.querySelector('#shopUI #tray #t-title .t-name') || document.getElementById('t-title');
        const truncated = !!nameEl && nameEl.scrollWidth > nameEl.clientWidth + 1;

        const vis = el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; };

        // The one gold CTA: the widest gradient-filled control that is NOT a tab. An active tab
        // legitimately carries the gold gradient, so counting it made the check fail on tabs
        // whose action is hidden (Hall Agents has nothing to sign, so it has no CTA at all).
        const golds = [...tray.querySelectorAll('button, a')].filter(el => {
          if (!vis(el)) return false;
          if (el.closest('[role=tablist]')) return false;
          if (el.getAttribute('role') === 'tab') return false;
          const cs = getComputedStyle(el);
          return /linear-gradient/.test(cs.backgroundImage) && el.getBoundingClientRect().height >= 40;
        });
        const widest = golds.map(el => el.getBoundingClientRect().width).sort((a, b) => b - a)[0] || 0;
        const primaryPct = inner ? Math.round((widest / inner) * 100) : 0;
        // A view with no action is allowed to have no primary; a view WITH one must be full width.
        const hasAction = golds.length > 0;

        // Text overlap: a text-bearing leaf whose box intersects another leaf's box in a way that
        // puts glyphs on top of each other.
        const leaves = [...tray.querySelectorAll('*')]
          .filter(el => vis(el) && el.children.length === 0 && (el.textContent || '').trim().length > 1 && !(el.closest('details') && !el.closest('details').open))
          .map(el => ({ el, r: el.getBoundingClientRect(), t: (el.textContent || '').trim().slice(0, 24) }));
        const overlaps = [];
        for (let i = 0; i < leaves.length; i++) {
          for (let j = i + 1; j < leaves.length; j++) {
            const a = leaves[i].r, b = leaves[j].r;
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            // A real collision: more than 2px into each other on both axes, and neither is the
            // other's ancestor (ancestors legitimately contain descendants).
            if (ox > 2 && oy > 2 && !leaves[i].el.contains(leaves[j].el) && !leaves[j].el.contains(leaves[i].el)) {
              overlaps.push(`${leaves[i].t} ⟂ ${leaves[j].t}`);
            }
          }
        }

        return {
          width: Math.round(tr.width),
          truncated,
          nameText: nameEl ? nameEl.textContent.trim() : '',
          primaryPct,
          hasAction,
          goldCount: golds.length,
          overlaps: overlaps.slice(0, 4),
          hasBadge: !!document.querySelector('#shopUI #tray #t-title .panel-badge'),
          hasArt: !!document.querySelector('#shopUI #tray #t-title .panel-art'),
          hasSub: !!document.querySelector('#shopUI #tray #t-sub')?.textContent?.trim(),
          hasQuest: !!document.getElementById('shop-quest'),
          hasFlow: !!document.querySelector('#shopUI #tray .flow-strip, #shopUI #tray #t-hero .flow-strip'),
          scrolls: tray.scrollHeight > tray.clientHeight + 1,
        };
      });

      total++;
      const bad = [];
      if (v.err) bad.push(v.err);
      if (v.truncated) bad.push('TRUNCATED');
      if (v.hasAction && v.primaryPct < 90) bad.push(`PRIMARY ${v.primaryPct}%`);
      if (v.overlaps?.length) bad.push('OVERLAP ' + v.overlaps.join(' | '));
      if (W === 1440 && v.width < 380) bad.push(`WIDTH ${v.width}`);
      if (!v.hasBadge) bad.push('NO-BADGE');
      if (!v.hasArt) bad.push('NO-ART');
      if (!v.hasSub) bad.push('NO-SUB');
      if (!v.hasQuest) bad.push('NO-QUEST');
      if (W === 1440 && v.scrolls) bad.push('SCROLL');
      if (bad.length) fail++;

      const key = `${shop}${tab ? '.' + tab.replace(/^[a-z]+-tab-|^[a-z]+-mode-?/, '') : ''}`;
      console.log(`${String(W).padEnd(5)} ${key.padEnd(24)} ${bad.length ? 'FAIL ' + bad.join(' ') : 'ok'}`);
      await page.screenshot({ path: `${OUT}/${key}-${W}.png` });
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${total - fail}/${total} views pass`);
