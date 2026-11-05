import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const pages = ['/', '/setup/', '/console', '/ledger', '/judges.html', '/loop', '/sign/', '/design/D8_shops/', '/llms.txt'];

for (const width of [1440, 390]) {
  for (const path of pages) {
    test(`axe ${path} at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      if (path.endsWith('.txt')) {
        const r = await page.request.get(path);
        expect(r.status()).toBe(200);
        expect(r.headers()['content-type'] || '').toContain('text/plain');
        expect(await r.text()).toContain('board.nearcarta.near');
        return;
      }
      const res = await page.goto(path);
      expect(res?.status()).toBeLessThan(400);
      await page.getByTestId('back-town').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
      const result = await new AxeBuilder({ page }).analyze();
      const bad = result.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
      expect(bad.map(v => v.id)).toEqual([]);
    });
  }
}
