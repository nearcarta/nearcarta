import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
for (const [w,h] of (process.env.W==='390'?[[390,844]]:[[1440,900],[390,844]])) {
  const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:5183/?play'); await p.waitForFunction(() => window.__marketday && document.body.classList.contains('md-play'), null, { timeout: 120000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { const m = window.__marketday; m.city.story.step = 9; m.leave(); }); await p.waitForTimeout(500);
  await p.evaluate(() => window.__marketday.enter()); await p.waitForTimeout(2500);
  await p.screenshot({ path: `/workspace/near/shots/games/story/week-dock-${w}.png` });
  await p.click('[data-testid=md-week]'); await p.waitForTimeout(+(process.env.MID||25000));
  await p.screenshot({ path: `/workspace/near/shots/games/story/week-mid-${w}.png` });
  await p.click('[data-act=wskip]'); await p.waitForTimeout(800);
  await p.screenshot({ path: `/workspace/near/shots/games/story/week-end-${w}.png` }); console.log(w, errs.slice(0, 2)); await p.close(); }
await b.close();
