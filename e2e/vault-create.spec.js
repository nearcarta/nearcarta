// Charter office entry from the town (/shops/vault/#create) at desktop and phone width.
// Sign in is the only header action and opens /setup. The free testnet trial lives on that page.
// A faucet sign-in runs only with VAULT_FAUCET=1.
import { test, expect } from '@playwright/test';

for (const [w, h] of [[1280, 800], [390, 844]]) {
  test.describe(`charter office #create at ${w}`, () => {
    // The first visit can land on a cold API (right after a deploy); one retry keeps a cold start from failing the suite.
    test.describe.configure({ retries: 1 });
    test.use({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });

    test('sign in is the only header action and opens setup', async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto('/shops/vault/#create');
      const sign = page.getByTestId('connect');
      await expect(sign).toHaveText('Sign in');
      await expect(sign).toBeFocused({ timeout: 60_000 });
      await expect(page.getByTestId('guest')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await sign.click();
      await expect(page).toHaveURL(/\/setup\/\?next=%2Fshops%2Fvault%2F/);
      await page.getByTestId('setup-wallet').click();
      await expect(page.locator('.connect-item').first()).toContainText('Guest testnet account', { timeout: 30_000 });
      expect(errors).toEqual([]);
    });

    test('guest sign-in sends nearcarta:signin and focuses Create', async ({ page }) => {
      test.skip(!process.env.VAULT_FAUCET, 'set VAULT_FAUCET=1 to make a faucet account');
      test.setTimeout(180_000);
      await page.goto('/setup/');
      await page.getByTestId('setup-guest').click();
      await expect(page.getByTestId('setup-who')).toHaveText(/ncguest-[a-z0-9]+\.testnet/, { timeout: 180_000 });
      await page.goto('/shops/vault/#create');
      await expect(page.getByTestId('create')).toBeFocused({ timeout: 60_000 });
      await expect(page.getByTestId('create')).toBeInViewport();
    });
  });
}
