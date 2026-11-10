// Shoots the Mist Bank card for a signed-in visitor: walks the story in practice to the Bank, then marks the
// browser as signed in to ACCOUNT (an existing session account) and presses Seal, which asks the Bank to seal.
//   ACCOUNT=<implicit> BASE=https://nearcarta.vercel.app W=1440 H=900 node e2e/bank-seal-shot.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://nearcarta.vercel.app', ACCOUNT = process.env.ACCOUNT;
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);
const dir = '/workspace/near/shots/games/bank-seal'; mkdirSync(dir, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: W, height: H } });
p.on('response', async (r) => { if (r.url().includes('/api/bank/seal')) console.log('seal', r.status(), (await r.text()).slice(0, 300)); });
await p.goto(BASE + '/?play', { waitUntil: 'domcontentloaded', timeout: 90000 });
await p.locator('[data-testid="md-practice"]').click({ timeout: 90000 });
for (const n of ['hall', 'ferry', 'toll', 'guard', 'arena']) {
  await p.locator('[data-testid="md-go"], [data-testid="qs-there"]').first().click({ timeout: 60000 }).catch(() => {});
  await p.locator('[data-testid="qs-act"]').waitFor({ state: 'visible', timeout: 90000 });
  await p.waitForTimeout(1500); await p.locator('[data-testid="qs-act"]').click({ timeout: 30000 });
  await p.waitForTimeout(1500); await p.locator('[data-testid="qs-next"]').click({ timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500); console.log('done', n);
}
await p.evaluate((a) => localStorage.setItem('nearcarta.marketday.live', JSON.stringify({ account: a })), ACCOUNT);
await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(8000);
await p.locator('[data-testid="md-go"], [data-testid="qs-there"]').first().click({ timeout: 90000 }).catch(() => {});
await p.locator('[data-testid="qs-act"]').waitFor({ state: 'visible', timeout: 90000 });
await p.waitForTimeout(2000); await p.screenshot({ path: `${dir}/bank-a-${W}.png` });
await p.locator('[data-testid="qs-act"]').click({ timeout: 30000 });
await p.locator('[data-testid="qs-next"]').waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
await p.waitForTimeout(2500); await p.screenshot({ path: `${dir}/bank-b-${W}.png` });
console.log('shots in', dir); await b.close();
