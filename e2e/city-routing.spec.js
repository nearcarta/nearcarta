// Every shop key opens its tray in the city, from ?shop= and from the All shops list.
// Regression: five list entries had no city key (Mist Bank and Vault Arena left the city), and a click
// during the 3D boot fell back to location.assign. The 2D path is deterministic, so it is the gate here;
// the 3D path is covered by the same router plus the unit tests in backend/test/unit/city-*.test.js.
import { test, expect } from '@playwright/test';

const SHOPS = [
  ['ferry', 'Ferry'],
  ['payouts', 'Payouts'],
  ['bank', 'Mist Bank'],
  ['chronicle', 'Chronicle'],
  ['guard', 'Guardhouse'],
  ['toll', 'Toll Bridge'],
  ['house', 'Your House'],
  ['arena', 'Vault Arena'],
  ['hall', 'Town Hall'],
];

for (const [id, title] of SHOPS) {
  test(`?shop=${id} opens the ${id} tray in the city`, async ({ page }) => {
    await page.goto(`/?mode=2d&nostory&shop=${id}`);
    await expect(page.locator('#t-title')).toHaveText(new RegExp('^' + title.replace(/ /g, '\\s') + '$'), { timeout: 30_000 });
    await expect(page.locator('#tray')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/in-shop/);
  });

  test(`the All shops entry for ${id} opens its tray without leaving the city`, async ({ page }) => {
    await page.goto('/?mode=2d&nostory');
    const start = page.url();
    await page.getByTestId('all-shops-link').click();
    const link = page.locator(`[data-enter-shop="${id}"], [data-city-shop="${id}"]`).first();
    await expect(link).toHaveAttribute('href', `/?shop=${id}`);
    await link.click();
    await expect(page.locator('#t-title')).toHaveText(new RegExp('^' + title.replace(/ /g, '\\s') + '$'), { timeout: 30_000 });
    await expect(page.locator('#tray')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/in-shop/);
    expect(new URL(page.url()).pathname, 'a shop entry must not leave the city').toBe(new URL(start).pathname);
  });
}
