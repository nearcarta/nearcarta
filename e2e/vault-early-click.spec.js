// Live regression: Sign in clicked the moment the page's HTML is parsed still opens setup.
// Opt-in: VAULT_E2E=1 (faucet).
import { test, expect } from '@playwright/test';

test.skip(!process.env.VAULT_E2E, 'set VAULT_E2E=1 (uses the public testnet faucet)');
test.setTimeout(120_000);

test('Sign in clicked at DOMContentLoaded opens setup', async ({ page }) => {
  await page.goto('/shops/vault/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('connect').click();
  await expect(page).toHaveURL(/\/setup\//);
  await page.getByTestId('setup-guest').click();
  await expect(page.getByTestId('setup-who')).toHaveText(/^ncguest-[a-z0-9]+\.testnet$/, { timeout: 90_000 });
});
