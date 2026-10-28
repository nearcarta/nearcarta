// Live regression: "Start free" clicked the moment the page's HTML is parsed (before the config fetch and the
// wallet selector finish) must still sign the guest in, not be dropped silently. Opt-in: VAULT_E2E=1 (faucet).
import { test, expect } from '@playwright/test';

test.skip(!process.env.VAULT_E2E, 'set VAULT_E2E=1 (uses the public testnet faucet)');
test.setTimeout(120_000);

test('Start free clicked at DOMContentLoaded signs in', async ({ page }) => {
  await page.goto('/shops/vault/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('guest').click();
  await expect(page.getByTestId('who')).toHaveText(/^ncguest-[a-z0-9]+\.testnet$/, { timeout: 90_000 });
});
