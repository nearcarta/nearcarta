// Market Day story: the whole first day at 1440x900 and 390x844, with layout checks on every shot.
// BASE=http://127.0.0.1:5183 OUT=dir SIZES=1440,390 node e2e/market-story-shots.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:5183', OUT = process.env.OUT || '/workspace/near/shots/games/story';
const SIZES = (process.env.SIZES || '1440,390').split(',').map(Number);
const ONLY = process.env.STEPS ? +process.env.STEPS : 9;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = {};
const checks = (p) => p.evaluate(() => {
  const vis = (e) => { if (!e) return false; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const out = { overflowX: document.documentElement.scrollWidth > innerWidth, small: [], overlap: [], gold: 0 };
  for (const el of document.querySelectorAll('#marketday button, #tray .qs button')) { if (!vis(el) || el.closest('.md-sheet:not(.open)')) continue; const r = el.getBoundingClientRect(); if (r.height < 40 && !el.classList.contains('qs-link')) out.small.push((el.className || el.textContent).slice(0, 30) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
  // gold buttons in view: Market Day's own plus any panel primary that still paints a gradient
  for (const el of document.querySelectorAll('.md-go, .qs-go, #tray .primary, #tray .cta')) { if (!vis(el) || el.disabled) continue; const s = getComputedStyle(el); if (s.backgroundImage.includes('gradient') || /rgb\(2[0-5]\d, 1[5-9]\d/.test(s.backgroundColor)) out.gold++; }
  const ui = ['.md-hud', '.md-dock', '.md-sheet.open', '#tray .qs'].map((q) => document.querySelector(q)).filter(vis).map((e) => [e.className, e.getBoundingClientRect()]);
  for (const bub of document.querySelectorAll('#bubbles .bub')) { if (+getComputedStyle(bub).opacity < 0.1) continue; const r = bub.getBoundingClientRect(); for (const [n, g] of ui) if (r.left < g.right && g.left < r.right && r.top < g.bottom && g.top < r.bottom) out.overlap.push('bubble/' + n); }
  for (let i = 0; i < ui.length; i++) for (let j = i + 1; j < ui.length; j++) { const a = ui[i][1], c = ui[j][1]; if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) out.overlap.push(ui[i][0] + '/' + ui[j][0]); }
  const st = document.querySelector('#tray .qs'); if (vis(st)) { const r = st.getBoundingClientRect(); const tr = document.querySelector('#tray').getBoundingClientRect(); if (r.right > tr.right + 1 || r.left < tr.left - 1) out.overlap.push('strip outside tray'); for (const e of document.querySelectorAll('#back, #stags .tag')) if (vis(e)) { const q = e.getBoundingClientRect(); if (r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom) out.overlap.push('strip/' + (e.id || e.className)); } }
  return out;
});
for (const W of SIZES) {
  const H = W < 500 ? 844 : 900;
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500, deviceScaleFactor: W < 500 ? 2 : 1 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 200))); p.on('console', (m) => { if (m.type() === 'error' && !/CORS|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
  await p.goto(BASE + '/?play');
  await p.waitForFunction(() => document.body.classList.contains('md-play'), null, { timeout: 120e3 });
  await p.waitForTimeout(+(process.env.SETTLE || 7000));
  const shot = async (name) => { await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/story-${name}-${W}.png` }); report[`${name}-${W}`] = await checks(p); };
  await shot('town');
  const steps = await p.evaluate(() => window.__marketday.story.STEPS.map((s) => s.shop));
  for (let i = 0; i < Math.min(ONLY, steps.length); i++) {
    if (i === 0) { await p.locator('[data-testid=md-go]').click(); await p.waitForTimeout(3500); await shot('walk'); }
    else await p.locator('[data-testid=qs-next]').click();
    await p.waitForFunction(() => document.body.classList.contains('in-shop') && document.querySelector('#tray .qs'), null, { timeout: 90e3 });
    await p.waitForTimeout(1800);
    if ([0, 4, 7].includes(i)) await shot(`${steps[i]}`);
    await p.locator('[data-testid=qs-act]').click();
    await p.waitForTimeout(600);
    if (i === 4) { await p.locator('#tray .qs [data-qs=why]').first().click(); await p.waitForTimeout(300); }
    if ([0, 3, 4, 8].includes(i)) await shot(`${steps[i]}-done`);
  }
  if (ONLY >= 9) { await p.locator('[data-testid=qs-next]').click(); await p.waitForFunction(() => !document.body.classList.contains('in-shop'), null, { timeout: 30e3 }); await p.waitForTimeout(2500); await shot('day-done'); }
  report['state-' + W] = await p.evaluate(() => { const c = window.__marketday.city; return { step: c.story?.step, near: String(c.players.you?.near), bag: c.players.you?.bag }; });
  report['errors-' + W] = errs;
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(report, null, 1));
