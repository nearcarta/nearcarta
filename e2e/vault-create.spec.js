// Charter office entry from the town (/shops/vault/#create) at desktop and phone width:
// the free guest is the first option and has focus; the NEAR Connect list starts with the guest wallet;
// after a guest sign-in the page sends nearcarta:signin and focuses "Create my charter".
// The sign-in step makes a real testnet account from the public faucet, so it runs only with VAULT_FAUCET=1.
import { test, expect } from '@playwright/test';

for (const [w, h] of [[1280, 800], [390, 844]]) {
  test.describe(`charter office #create at ${w}`, () => {
    // The first visit can land on a cold API (free plan); one retry keeps a cold start from failing the suite.
    test.describe.configure({ retries: 1 });
    test.use({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });

    test('guest first and focused, no sideways scroll', async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto('/shops/vault/#create');
      const guest = page.getByTestId('guest');
      await expect(guest).toBeFocused({ timeout: 60_000 });
      await expect(guest).toBeInViewport();
      expect(await page.$$eval('.who button:not([hidden])', bs => bs.map(b => b.id))).toEqual(['guest', 'connect']);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByTestId('connect').click();
      await expect(page.locator('.connect-item').first()).toContainText('Guest testnet account', { timeout: 30_000 });
      expect(errors).toEqual([]);
    });

    test('guest sign-in sends nearcarta:signin and focuses Create', async ({ page }) => {
      test.skip(!process.env.VAULT_FAUCET, 'set VAULT_FAUCET=1 to make a faucet account');
      test.setTimeout(180_000);
      await page.goto('/shops/vault/#create');
      await expect(page.getByTestId('guest')).toBeFocused({ timeout: 60_000 });
      const ev = page.evaluate(() => new Promise(r => addEventListener('nearcarta:signin', e => r(e.detail), { once: true })));
      await page.getByTestId('guest').click();
      expect((await ev).accountId).toMatch(/^ncguest-[a-z0-9]+\.testnet$/);
      await expect(page.getByTestId('create')).toBeFocused({ timeout: 60_000 });
      await expect(page.getByTestId('create')).toBeInViewport();
    });
  });
}
