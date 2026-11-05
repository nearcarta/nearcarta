import { test, expect } from '@playwright/test';

test('town intro plays once', async ({ page }) => {
  test.setTimeout(40_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mode=2d');
  const line = page.getByTestId('intro-line');
  await expect(line).toBeVisible();
  const host = page.getByTestId('town-intro');
  const pan1 = await host.evaluate(el => getComputedStyle(el).getPropertyValue('--pan'));
  await page.waitForTimeout(1200);
  const pan2 = await host.evaluate(el => getComputedStyle(el).getPropertyValue('--pan'));
  expect(pan1).not.toBe(pan2);
  await expect(line).toBeVisible();
  await page.goto('/?mode=2d&nostory');
  await expect(page.getByTestId('town-intro')).toHaveCount(0);
});

test('back to town is on screen in a shop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mode=2d&nostory&shop=ferry');
  const back = page.getByTestId('back-town');
  await expect(back).toBeVisible({ timeout: 20_000 });
  const box = await back.boundingBox();
  expect(box.x).toBeGreaterThan(0);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await back.click();
  await expect(page.locator('body')).not.toHaveClass(/in-shop/, { timeout: 5_000 });
  await expect(page.locator('#fbpins .fbpin').first()).toBeVisible();
});

test('console title has no rehearsal-network word and the ferry heading is visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/console');
  await expect(page).toHaveTitle(/Nearcarta/);
  const title = await page.title();
  expect(title.toLowerCase()).not.toContain('testnet');
  const h2 = page.locator('#ferry h2');
  await expect(h2).toBeVisible();
  const box = await h2.boundingBox();
  expect(box.y).toBeGreaterThan(40);
});

test('a narrow screen does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/console');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
