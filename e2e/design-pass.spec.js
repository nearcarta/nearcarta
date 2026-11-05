// Graphite design pass: every public page, both widths, no warm or navy page fills.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const shots = process.env.SHOTS_DIR || '/opt/cursor/artifacts/screenshots';
mkdirSync(shots, { recursive: true });

const pages = [
  ['town', '/?mode=2d'],
  ['setup', '/setup/?preview=1#signin'],
  ['setup-character', '/setup/?preview=1#character'],
  ['setup-try', '/setup/?preview=1#try'],
  ['office', '/shops/vault/'],
  ['hall', '/shops/hall/'],
  ['console', '/console'],
  ['ledger', '/ledger'],
  ['judges', '/judges.html'],
  ['loop', '/loop'],
  ['sign', '/sign/'],
  ['pay', '/ferry-widget'],
  ['notfound', '/404.html'],
  ['shops', '/design/D8_shops/?2d&shop=house'],
  ['shops-street', '/design/D8_shops/?2d'],
];

function paint(bg) {
  const m = String(bg).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const r = +m[1], g = +m[2], b = +m[3];
  const warm = r > g + 18 && r > b + 18 && r > 50;
  const navy = b > r + 14 && b > g + 8 && r < 48 && g < 70 && b > 28;
  return (warm || navy) ? `${bg} warm=${warm} navy=${navy}` : null;
}

for (const width of [1440, 390]) {
  test.describe(`design ${width}`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    for (const [name, path] of pages) {
      test(`${name}`, async ({ page }) => {
        const res = await page.goto(path);
        expect(res?.status()).toBeLessThan(500);
        if (path.startsWith('/?')) {
          await page.waitForFunction(() => document.body.classList.contains('fb') || document.body.classList.contains('ready'), null, { timeout: 30_000 });
          await expect(page.getByTestId('back-town')).toBeHidden();
        } else if (name.startsWith('setup')) {
          await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
        } else if (name === 'shops') {
          await expect(page.locator('#t-title')).not.toHaveText('', { timeout: 20_000 });
        } else if (name === 'shops-street') {
          await expect(page.locator('#tags .lb').first()).toBeVisible({ timeout: 20_000 });
        }
        if (!path.startsWith('/?')) {
          await expect(page.getByTestId('back-town').first()).toBeVisible({ timeout: 20_000 });
        }
        const bad = await page.evaluate(() => {
          const sel = 'html, body, .card, .scene, .back-town, header, #tray, .box, main, .tot div, form, #chron';
          const out = [];
          for (const el of document.querySelectorAll(sel)) {
            const bg = getComputedStyle(el).backgroundColor;
            out.push(bg);
          }
          return out;
        });
        const hits = bad.map(paint).filter(Boolean);
        expect(hits, hits.join(' | ')).toEqual([]);
        if (name !== 'missing') {
          const axe = await new AxeBuilder({ page }).withTags(['wcag2aa']).include('body').analyze();
          const contrast = axe.violations.filter(v => v.id === 'color-contrast');
          expect(contrast.map(v => v.nodes.slice(0, 3).map(n => n.html))).toEqual([]);
        }
        await page.screenshot({ path: `${shots}/design-${name}-${width}.png`, fullPage: !['town', 'shops', 'shops-street'].includes(name) });
      });
    }
  });
}
