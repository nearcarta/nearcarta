// Walks the nine Market Day steps in practice and shoots each shop before and after its step.
//   BASE=https://nearcarta.vercel.app TAG=before node e2e/market-walk-shots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5185', TAG = process.env.TAG || 'now';
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);
const dir = `/workspace/near/shots/games/walk/${TAG}`; mkdirSync(dir, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: W, height: H } });
const runs = [];
p.on('response', async (r) => { if (r.url().includes('/api/merchant/step') || r.url().includes('/api/bank/seal')) { const t = await r.text().catch(() => ''); runs.push(t); console.log('api', r.status(), t.slice(0, 400)); } });
const shot = (n) => p.screenshot({ path: `${dir}/${n}-${W}.png` });
await p.goto(BASE + '/?play', { waitUntil: 'domcontentloaded', timeout: 90000 });
await p.locator('[data-testid="md-practice"]').click({ timeout: 90000 });
const names = ['hall', 'ferry', 'toll', 'guard', 'arena', 'bank', 'payouts', 'house', 'chronicle'];
for (const n of names) {
  const go = p.locator('[data-testid="md-go"], [data-testid="qs-there"]').first();
  await go.click({ timeout: 60000 }).catch(() => {});
  await p.locator('[data-testid="qs-act"]').waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(2500); await shot(`${n}-a`);
  await p.locator('[data-testid="qs-act"]').click({ timeout: 30000 }).catch((e) => console.log(n, 'act', String(e).split('\n')[0]));
  await p.waitForTimeout(2500); await shot(`${n}-b`);
  await p.locator('[data-testid="qs-next"]').click({ timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(3000);
}
console.log('shots in', dir);
await b.close();
