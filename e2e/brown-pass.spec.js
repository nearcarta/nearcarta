// Brown polish pass: every page at 1440 and 390, contrast, and the town page hides Back to town.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const shots = process.env.SHOTS_DIR || '/opt/cursor/artifacts/screenshots';
mkdirSync(shots, { recursive: true });

const pages = [
  ['town', '/?mode=2d', false],
  ['setup', '/setup/?preview=1#signin', true],
  ['setup-character', '/setup/?preview=1#character', true],
  ['setup-try', '/setup/?preview=1#try', true],
  ['office', '/shops/vault/', true],
  ['hall', '/shops/hall/', true],
  ['console', '/console', true],
  ['ledger', '/ledger', true],
  ['judges', '/judges.html', true],
  ['loop', '/loop', true],
  ['sign', '/sign/', true],
  ['pay', '/ferry-widget', true],
  ['notfound', '/404.html', true],
  ['shops', '/design/D8_shops/?2d&shop=toll', false],
  ['shops-street', '/design/D8_shops/?2d', false],
];

for (const width of [1440, 390]) {
  for (const [name, path, full] of pages) {
    test(`${name} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const res = await page.goto(path);
      expect(res?.status()).toBeLessThan(400);
      if (name === 'town' || name.startsWith('shops')) {
        await page.waitForFunction(() => document.body.classList.contains('fb') || document.body.classList.contains('ready') || document.body.classList.contains('flat'), null, { timeout: 30_000 }).catch(() => {});
      }
      if (name.startsWith('setup')) await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 30_000 });
      if (name === 'shops') await page.locator('#t-title').waitFor({ timeout: 30_000 });
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(/Return to the city/);
      expect(body).not.toMatch(/Failed to fetch/);
      expect(body).not.toMatch(/FROZEN by a DAO/);
      if (name === 'town') {
        await expect(page.locator('body > a.back-town')).toHaveCount(0);
        if (await page.getByTestId('back-town').count()) await expect(page.getByTestId('back-town')).toBeHidden();
      } else {
        await expect(page.getByTestId('back-town')).toBeVisible();
      }
      const axe = await new AxeBuilder({ page }).withTags(['wcag2aa']).disableRules(['region']).analyze();
      const contrast = axe.violations.filter(v => v.id === 'color-contrast');
      expect(contrast.map(v => v.nodes.map(n => n.html).slice(0, 2))).toEqual([]);
      await page.screenshot({ path: `${shots}/brown-${name}-${width}.png`, fullPage: full && name !== 'town' });
    });
  }
}
