import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });

const routes = [
  ['ferry', '/shops/ferry/'],
  ['guard', '/shops/guard/'],
  ['guardhouse', '/shops/guardhouse/'],
  ['hall', '/shops/hall/'],
  ['townhall', '/shops/townhall/'],
  ['bank', '/shops/bank/'],
  ['mist', '/shops/mist/'],
  ['arena', '/shops/arena/'],
  ['toll', '/shops/toll/'],
  ['chronicle', '/shops/chronicle/'],
  ['house', '/shops/house/'],
  ['payouts', '/shops/payouts/'],
  ['vault', '/shops/vault/'],
];

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  expect(h.network?.contracts).toBe('mainnet');
  expect(h.features?.signing).toBe(false);
});

for (const width of [1440, 390]) {
  for (const [name, path] of routes) {
    test(`${name} at ${width} has no raw error and passes axe`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(res?.status() ?? 200).toBeLessThan(400);
      if (name === 'ferry') {
        await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=ferry-usd]')].some(n => /\$/.test(n.textContent || '')), null, { timeout: 30000 }).catch(() => {});
      }
      if (name === 'house') {
        await page.locator('[data-testid=house-state], [data-testid=room-boundary]').first().waitFor({ timeout: 8000 }).catch(() => {});
      }
      await page.waitForTimeout(400);
      const text = await page.locator('body').innerText();
      expect(text).not.toMatch(/Cannot read properties/i);
      expect(text).not.toMatch(/preview\.near/);
      await page.screenshot({ path: `${shots}/l-${name}-${width}.png`, fullPage: false });
      const result = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
      const bad = result.violations.filter(v => v.impact === 'critical');
      expect(bad.map(v => `${v.id} ${v.help}`)).toEqual([]);
    });
  }
}

test('ferry shows three corridors and payouts keeps the whole account name', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/shops/ferry/');
  await expect(page.getByTestId('ferry-corridor')).toHaveCount(3);
  await expect(page.getByTestId('ferry-usd').first()).toBeVisible();
  await page.goto('/shops/payouts/');
  // A payroll row does not exist until one is added, so the account field has to be created first.
  // The old test filled `payout-to` on arrival and timed out for 90s against a page that was
  // working correctly; section-m M3 does the same flow properly and passes.
  await page.getByTestId('payouts-tab-payroll').click();
  await page.getByTestId('payout-add').click();
  const box = page.getByTestId('payout-to').first();
  await box.fill('bob.near');
  // The page never had a `payout-issues` element; what proves the name was accepted is that it
  // stays in the field and the row is still usable. Assert the value the visitor typed survived,
  // which is the point of the test's title ("keeps the whole account name").
  await expect(page.getByTestId('payout-to').first()).toHaveValue('bob.near');
});
