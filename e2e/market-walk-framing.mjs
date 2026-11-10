import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const W = +(process.env.W || 390), H = W === 390 ? 844 : 900;
const p = await b.newPage({ viewport: { width: W, height: H } });
await p.goto('http://127.0.0.1:5183/?play'); await p.waitForFunction(() => window.__marketday && document.body.classList.contains('md-play'), null, { timeout: 120000 });
await p.waitForTimeout(3000);
await p.evaluate(() => { const m = window.__marketday; m.city.story.step = 4; m.city.players.you.bag['good:salt'] = 3; window.world.quest.target('arena'); setTimeout(() => m.go(), 2500); });
for (const t of [2, 5, 8]) { await p.waitForTimeout(t === 2 ? 4500 : 3000); await p.screenshot({ path: `/workspace/near/shots/games/story/walk-arena-${t}s-${W}.png` }); }
await b.close();
