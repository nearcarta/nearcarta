import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });

const pages = [
  ['ferry', '/console#ferry'],
  ['guardhouse', '/console#guardhouse'],
  ['townhall', '/console#townhall'],
  ['arena', '/console#arena'],
  ['toll', '/console#toll'],
  ['chronicle', '/console#chronicle'],
  ['house', '/console#house'],
  ['hall', '/shops/hall/'],
  ['payouts', '/shops/payouts/'],
  ['vault', '/shops/vault/'],
  ['judges', '/judges.html'],
  ['town-ferry', '/?nostory&shop=ferry'],
  ['town-guard', '/?nostory&shop=guard'],
  ['town-bank', '/?nostory&shop=bank'],
  ['town-arena', '/?nostory&shop=arena'],
  ['town-toll', '/?nostory&shop=toll'],
  ['town-hall', '/?nostory&shop=hall'],
  ['town-chronicle', '/?nostory&shop=chronicle'],
  ['town-payouts', '/?nostory&shop=payouts'],
  ['town-house', '/?nostory&shop=house'],
];

test('a town session is the hall session, and ?next= comes back to that row', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nearcarta.setup.v1', JSON.stringify({ accountId: 'visitor.near', displayName: 'Scholar', balanceNear: 0 })));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/shops/hall/');
  await expect(page.getByTestId('connect')).toBeHidden();
  await expect(page.getByTestId('who')).toContainText('Scholar');
  await expect(page.getByTestId('who')).toContainText('Fund');
  await page.goto('/setup/?next=%2Fshops%2Fhall%2F');
  await page.waitForURL(/\/shops\/hall\/?(\?|$)/, { timeout: 30_000 });
  await expect(page.getByTestId('connect')).toBeHidden();
  await expect(page).not.toHaveURL(/preview=1/);
});

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  expect(h.network?.contracts, 'the shop pages must read a mainnet API, not a mock').toBe('mainnet');
  expect(h.features?.signing).toBe(false);
});

for (const width of [1440, 390]) {
  for (const [name, path] of pages) {
    test(`${name} at ${width} uses the live API`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(res?.status() ?? 200).toBeLessThan(400);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${shots}/k-${name}-${width}.png`, fullPage: false });
      const result = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
      const bad = result.violations.filter(v => v.impact === 'critical');
      expect(bad.map(v => `${v.id} ${v.help}`)).toEqual([]);
    });
  }
}
