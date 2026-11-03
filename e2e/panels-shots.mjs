// Live read-only pass: open each shop's side panel at 390 and 1440 and screenshot it. Signs nothing.
// TAG=before|after OUT=dir node e2e/panels-shots.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'https://nearcarta.vercel.app', TAG = process.env.TAG || 'after', OUT = process.env.OUT || '/workspace/near/judges_review/panels_after';
const SHOPS = ['guard', 'ferry', 'hall', 'bank', 'arena', 'toll', 'chronicle', 'house', 'payouts'];
const b = await chromium.launch(), out = {};
for (const [W, H] of [[390, 844], [1440, 900]]) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500, deviceScaleFactor: W < 500 ? 2 : 1 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  for (const s of SHOPS) {
    try {
      await p.goto(BASE + '/design/D9_world/?shop=' + s); await p.locator('#t-proof').waitFor({ state: 'visible', timeout: 90e3 });
      await p.waitForTimeout(5000); await p.locator('#t-proof').click(); await p.waitForTimeout(6000);
      await p.screenshot({ path: `${OUT}/${TAG}-${s}-${W}.png` });
      out[`${s}-${W}`] = { chars: (await p.locator('#d-body').innerText()).length };
    } catch (e) { out[`${s}-${W}`] = { error: String(e).slice(0, 120) }; }
  }
  out['errors-' + W] = errs; await ctx.close();
}
await b.close(); console.log(JSON.stringify(out));
