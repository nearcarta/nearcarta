// The first load budget: the two entry buttons are usable in well under 5 s, before the town finishes
// loading, and the two big optional bundles are not fetched until someone needs them.
//
// Docs: https://web.dev/articles/lcp (the paint metrics these read)
import { test, expect } from '@playwright/test';

test('the entry buttons are usable before the town finishes loading', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/');
  // The gold action is visible almost immediately: it is markup, not the scene.
  await expect(page.getByTestId('try-free')).toBeVisible({ timeout: 15_000 });
  const usableMs = Date.now() - t0;
  expect(usableMs, `Try free took ${usableMs} ms to be usable`).toBeLessThan(5000);
  // The first paint happened even earlier.
  const paints = await page.evaluate(() => performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
  const fcp = paints.find(([n]) => n === 'first-contentful-paint');
  if (fcp) expect(fcp[1], 'first contentful paint').toBeLessThan(5000);
});

test('the guest and wallet bundles are not downloaded on first load', async ({ page }) => {
  const seen = [];
  page.on('request', (r) => seen.push(r.url()));
  await page.goto('/');
  await expect(page.getByTestId('try-free')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  // ~460 KB and ~166 KB, and nothing needs either until a visitor presses a step or signs in.
  expect(seen.some((u) => /live-guest\.js/.test(u)), 'the guest bundle is lazy').toBe(false);
  expect(seen.some((u) => /house\.bundle\.js/.test(u)), 'the wallet bundle is lazy').toBe(false);
});

test('the market and the errand are ready together on a slow phone', async ({ page }) => {
  // The brief's budget: the market loads and a guest could act in under 5 s. Throttle to a mid-range phone
  // on a slow link, which is the honest reading of that budget.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const t0 = Date.now();
  await page.goto('/?mode=2d&net=testnet');
  // Both front-door beats: the Market Day entry and the scam errand.
  await expect(page.getByTestId('md-enter')).toBeAttached({ timeout: 20_000 });
  const marketMs = Date.now() - t0;
  await expect(page.getByTestId('scam-errand')).toBeVisible({ timeout: 20_000 });
  const errandMs = Date.now() - t0;
  expect(marketMs, `the market took ${marketMs} ms on a throttled phone`).toBeLessThan(5000);
  expect(errandMs, `the errand took ${errandMs} ms on a throttled phone`).toBeLessThan(5000);
});
