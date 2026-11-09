// Market Day in the city: screenshots of every view at 1440x900 and 390x844, plus layout checks
// (no overflow, no internal scroll on desktop, taps >= 40 px, no overlap with the town HUD).
// Practice round only: signs nothing. BASE=http://127.0.0.1:5177 OUT=dir node e2e/market-day-shots.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:5177', OUT = process.env.OUT || '/workspace/near/shots/games', TAG = process.env.TAG || 'md';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = {};
const checks = (p) => p.evaluate(() => {
  const out = { overflowX: document.documentElement.scrollWidth > innerWidth, small: [], overlap: [], sheetScroll: false };
  const sheet = document.querySelector('.md-sheet.open');
  if (sheet && innerWidth > 720) out.sheetScroll = sheet.scrollHeight > sheet.clientHeight + 1;
  for (const el of document.querySelectorAll('#marketday button')) {
    const r = el.getBoundingClientRect(); if (!r.width || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.closest('.md-sheet:not(.open)')) continue;
    if (r.height < 40 && !el.closest('.md-step')) out.small.push((el.dataset.testid || el.textContent.trim()).slice(0, 30) + ':' + Math.round(r.height));
  }
  const vis = (e) => getComputedStyle(e).opacity !== '0';
  const boxes = ['.md-hud', '.md-dock', '.md-sheet.open', '#brand', '#acct', '.all-shops', '#zoom'].map((s) => [s, document.querySelector(s)]).filter(([, e]) => e && e.getBoundingClientRect().width && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && vis(e));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i][1].getBoundingClientRect(), c = boxes[j][1].getBoundingClientRect();
    if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) out.overlap.push(boxes[i][0] + '×' + boxes[j][0]);
  }
  // No shop name tag may peek out from under the open sheet.
  if (sheet) { const s = sheet.getBoundingClientRect(); for (const t of document.querySelectorAll('#pins .pin.on .ban')) {
    const r = t.getBoundingClientRect(); if (!r.width || (getComputedStyle(t.closest('.pin')).opacity === '0' || getComputedStyle(t).visibility === 'hidden')) continue;
    if (r.left < s.right && s.left < r.right && r.top < s.bottom && s.top < r.bottom) out.overlap.push('tag:' + t.textContent.trim().slice(0, 20) + '×sheet');
  } }
  // Town chatter never sits on the game's HUD, dock, sheet or spots.
  const game = ['.md-hud', '.md-dock', '.md-sheet.open', '.md-node'].flatMap((q) => [...document.querySelectorAll(q)]).filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect()).filter((r) => r.width);
  for (const bub of document.querySelectorAll('#bubbles .bub')) { if (+getComputedStyle(bub).opacity < 0.1) continue; const r = bub.getBoundingClientRect();
    if (game.some((g) => r.left < g.right && g.left < r.right && r.top < g.bottom && g.top < r.bottom)) out.overlap.push('bubble:' + bub.textContent.slice(0, 20)); }
  return out;
});
for (const [W, H] of [[1440, 900], [390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500, deviceScaleFactor: W < 500 ? 2 : 1 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await p.addInitScript(() => { try { localStorage.setItem('nearcarta.marketday.v1.seen', '1'); } catch {} });
  await p.goto(BASE + '/?play');
  await p.waitForFunction(() => document.body.classList.contains('md-play'), null, { timeout: 120e3 });
  await p.waitForTimeout(+(process.env.SETTLE || 9000));
  const shot = async (name) => { await p.waitForTimeout(500); await p.waitForFunction(() => { const s = document.querySelector('.md-sheet.open'); return !s || getComputedStyle(s).opacity === '1'; }, null, { timeout: 15e3 }).catch(() => {}); await p.screenshot({ path: `${OUT}/${TAG}-${name}-${W}.png` }); report[`${name}-${W}`] = await checks(p); };
  await shot('town');
  // gather from every visible node, twice where a tool is not yet made
  const nodes = await p.locator('.md-node:visible').all();
  for (const n of nodes) await n.click({ force: true }).catch(() => {});
  await p.evaluate(() => { const c = window.__marketday.city; c.t += 31; });
  for (const n of nodes) await n.click({ force: true }).catch(() => {});
  await p.waitForTimeout(900);
  await shot('gathered');
  await p.locator('[data-testid=md-market]').click(); await shot('market');
  await p.locator('[data-testid=md-good-iron]').click(); await shot('counter');
  await p.locator('[data-testid=md-why]').click(); await shot('why');
  await p.locator('[data-testid=md-why]').click();
  if (await p.locator('[data-testid=md-sell]').count()) { await p.locator('[data-testid=md-sell]').click(); await shot('sold'); }
  await p.locator('[data-testid=md-bag]').click(); await shot('bag');
  await p.locator('[data-testid=md-quests]').click(); await shot('orders');
  report['errors-' + W] = errs; report['nodes-' + W] = nodes.length;
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(report, null, 1));
