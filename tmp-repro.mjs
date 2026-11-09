import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:5173';
const b = await chromium.launch();

async function panel(shop, setup) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/design/D9_world/?shop=${shop}&nostory`, { waitUntil: 'domcontentloaded' });
  await p.locator('#shopUI #tray').waitFor({ state: 'visible', timeout: 60000 });
  await p.waitForTimeout(3000);
  if (setup) await setup(p);
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const tray = document.querySelector('#shopUI #tray');
    const sc = tray.querySelector(':scope > .t-scroll');
    const cs = el => getComputedStyle(el);
    const uniq = arr => [...new Set(arr)].sort((a, b) => parseFloat(a) - parseFloat(b));
    const scope = tray;
    const radii = [], fonts = [], heights = [], pads = [];
    for (const el of scope.querySelectorAll('button, input, select, textarea, a, details, summary, div, section, p, li')) {
      const b = el.getBoundingClientRect();
      if (b.width < 8 || b.height < 8) continue;
      const s = cs(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      radii.push(s.borderTopLeftRadius);
      const tag = el.tagName;
      if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(tag)) { fonts.push(s.fontSize); heights.push(+b.height.toFixed(1)); pads.push(s.padding); }
      if (tag === 'P' || tag === 'LI' || tag === 'SPAN') fonts.push(s.fontSize);
    }
    const modeBtns = [...tray.querySelectorAll('.arena-mode')].map(m => ({ txt: m.textContent, pressed: m.getAttribute('aria-pressed'), borderColor: cs(m).borderTopColor, color: cs(m).color, bg: cs(m).backgroundColor, h: +m.getBoundingClientRect().height.toFixed(1), w: +m.getBoundingClientRect().width.toFixed(1) }));
    const tabs = [...tray.querySelectorAll('.ferry-tab')].map(m => ({ txt: m.textContent, h: +m.getBoundingClientRect().height.toFixed(1) }));
    const hint = tray.querySelector(':scope > .more-hint');
    const hr = hint?.getBoundingClientRect();
    const hcs = hint ? cs(hint) : null;
    return {
      radii: uniq(radii), fonts: uniq(fonts), controlHeights: uniq(heights.map(String)).map(Number), controlPads: uniq(pads),
      modeBtns, tabs,
      hint: hint ? { h: +hr.height.toFixed(2), innerContentH: +(hr.height - parseFloat(hcs.paddingTop) - parseFloat(hcs.paddingBottom) - parseFloat(hcs.borderTopWidth) * 2).toFixed(2), font: hcs.fontSize, lh: hcs.lineHeight, tag: hint.tagName, role: hint.getAttribute('role'), tabindex: hint.getAttribute('tabindex'), ariaHidden: hint.getAttribute('aria-hidden'), pointer: hcs.pointerEvents } : null,
      scrollOverflow: { tray: [tray.scrollWidth, tray.clientWidth], sc: [sc.scrollWidth, sc.clientWidth, sc.scrollHeight, sc.clientHeight] },
    };
  });
  await ctx.close();
  return r;
}

const arena = await panel('arena', async p => {
  await p.evaluate(async () => {
    const mod = await import('/panels/arena/tray.js');
    const form = document.querySelector('#t-form');
    form.hidden = false;
    form.innerHTML = mod.arenaHtml({
      tab: 'guardians', mode: 'feed', feedId: 'g1', feedAmt: '0.01',
      guardians: [
        { id: 'g1', title: 'Visitor Guardian', creator: '8ccd5d33d2e8eb2d27eef13a7a0c88ae2ea9209c002fa7f27', pot: '—', fee: '—' },
        { id: 'g2', title: 'Mainnet guardian', creator: 'nearcarta.near', pot: '0.04', fee: '0.001' },
      ],
      status: 'Deployed token. Not an arena v2 pot.',
    });
  });
});

const house = await panel('house', null).catch(e => String(e));

// house leak check: is the closed details' content still laid out?
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(`${BASE}/design/D9_world/?shop=house&nostory&owner=8ccd5d33d2e8eb2d27eef13a7a0c88ae2ea9209c002fa7f27`, { waitUntil: 'domcontentloaded' });
await p.locator('#shopUI #tray').waitFor({ state: 'visible', timeout: 60000 });
await p.waitForTimeout(4000);
const leak = await p.evaluate(() => {
  const rec = document.querySelector('[data-testid=house-record]');
  const meta = rec?.querySelector('.deed-meta');
  const read = rec?.querySelector('[data-testid=house-read]');
  const hist = document.querySelector('[data-testid=house-history]');
  const rr = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { y: +b.y.toFixed(1), h: +b.height.toFixed(1), bot: +b.bottom.toFixed(1), display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility }; };
  const a = meta?.getBoundingClientRect(), c = hist?.getBoundingClientRect();
  const overlap = a && c ? Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) : null;
  return { recordOpen: rec?.open, recordHidden: rec?.hidden, meta: rr(meta), read: rr(read), hist: rr(hist), overlapPx: overlap == null ? null : +overlap.toFixed(1) };
});
await p.locator('#shopUI #tray').screenshot({ path: '/tmp/final-house.png' });
await ctx.close();

// chain badge on the flow
const ctx2 = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 4 });
const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/design/D9_world/?shop=house&nostory&owner=8ccd5d33d2e8eb2d27eef13a7a0c88ae2ea9209c002fa7f27`, { waitUntil: 'domcontentloaded' });
await p2.locator('#shopUI #tray').waitFor({ state: 'visible', timeout: 60000 });
await p2.waitForTimeout(4000);
const flowBox = await p2.locator('#house-flow').boundingBox();
if (flowBox) await p2.screenshot({ path: '/tmp/final-flow.png', clip: flowBox });
const badge = await p2.evaluate(() => {
  const ci = document.querySelector('#house-flow .ci');
  const ti = document.querySelector('#house-flow .ti');
  if (!ci) return null;
  const s = getComputedStyle(ci), st = getComputedStyle(ti);
  const cr = ci.getBoundingClientRect(), tr = ti.getBoundingClientRect();
  return { ci: { w: +cr.width.toFixed(1), h: +cr.height.toFixed(1), r: s.borderTopLeftRadius, ring: s.boxShadow, bg: s.backgroundColor, right: s.right, bottom: s.bottom, src: ci.getAttribute('src') },
    ti: { w: +tr.width.toFixed(1), h: +tr.height.toFixed(1), r: st.borderRadius },
    overlapIntoToken: { dx: +(tr.right - cr.left).toFixed(1), dy: +(tr.bottom - cr.top).toFixed(1) },
    flowBg: getComputedStyle(document.querySelector('#house-flow')).backgroundColor };
});
await ctx2.close();

writeFileSync('/tmp/final-check.json', JSON.stringify({ arena, house, leak, badge }, null, 1));
console.log(JSON.stringify({ arena, house, leak, badge }, null, 1));
await b.close();
