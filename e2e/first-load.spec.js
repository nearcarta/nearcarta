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
