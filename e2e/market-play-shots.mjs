// Shots: the Play-for-real sheet, and the fast-forward (real history, then the practice tail). BASE env, default local.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:5185', OUT = process.env.OUT || '/workspace/near/shots/games/play';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/?play'); await p.waitForFunction(() => window.__marketday && document.body.classList.contains('md-play'), null, { timeout: 120000 });
  await p.waitForSelector('[data-testid=md-sign]', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/signin-${w}.png` });
  await p.evaluate(() => { window.__marketday.close?.(); }); await p.click('[data-testid=md-practice]').catch(() => {});
  await p.evaluate(() => { const c = window.__marketday.city; c.story.step = 9; }); await p.waitForTimeout(300);
  await p.evaluate(() => window.__marketday.open('week')); await p.waitForTimeout(6000);
  await p.screenshot({ path: `${OUT}/replay-${w}.png` });
  await p.click('[data-act=wskip]').catch(() => {}); await p.waitForTimeout(600);
  await p.click('[data-testid=md-wnext]').catch(() => {}); await p.waitForTimeout(8000);
  await p.screenshot({ path: `${OUT}/practice-${w}.png` });
  console.log(w, errs.slice(0, 3)); await p.close();
}
await b.close();
