import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
for (const [w,h] of [[1440,900],[390,844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:5184/?play'); await p.waitForFunction(() => window.__marketday && document.body.classList.contains('md-play'), null, { timeout: 120000 }); await p.waitForTimeout(4000);
  await p.evaluate(() => dispatchEvent(new CustomEvent('world:keeper-tap', { detail: { id: 'ferry' } }))); await p.waitForTimeout(3500);
  await p.screenshot({ path: `/workspace/near/shots/games/story/keeper-live-${w}.png` }); console.log(w, errs.slice(0, 2)); await p.close(); }
await b.close();
