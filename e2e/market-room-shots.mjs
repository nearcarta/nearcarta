import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
for (const [w,h] of (process.env.W==='390'?[[390,844]]:process.env.W==='1440'?[[1440,900]]:[[1440,900],[390,844]])) for (const id of (process.env.IDS || 'hall,guard').split(',')) {
  const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:5183/?shop=${id}`); await p.waitForTimeout(+(process.env.WAIT||30000));
  await p.screenshot({ path: `/workspace/near/shots/games/story/room-${id}-${w}.png` }); console.log(id, w, errs.slice(0,2)); await p.close(); }
await b.close();
