import { chromium } from 'playwright';
// Sign-in field check: the email field must take typing within a second at 1440 and 390.
const BASE = process.env.BASE || 'http://127.0.0.1:5185'; const b = await chromium.launch();
for (const [w,h] of [[1440,900],[390,844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(BASE + '/?play', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const t0 = Date.now(); const inp = p.locator('[data-testid="md-sign"] input').first();
  try { await inp.waitFor({ state: 'visible', timeout: 60000 }); } catch { console.log(w, 'not visible in 60s'); continue; }
  const vis = Date.now() - t0; const t1 = Date.now();
  try { await inp.click({ timeout: 8000 }); await inp.pressSequentially('test@example.com', { timeout: 15000 }); console.log(w, 'visible', vis, 'ms; typed in', Date.now() - t1, 'ms; value', await inp.inputValue()); } catch (e) { console.log(w, 'FAILED', String(e).split('\n')[0]); }
  await p.screenshot({ path: `/workspace/near/shots/games/signin-input-${process.env.TAG || "now"}-${w}.png` });
}
await b.close();
