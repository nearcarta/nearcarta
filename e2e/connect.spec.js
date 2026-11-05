// Wallet connect through NEAR Connect, without signing: the town and the console show "Sign in",
// which opens /setup; its NEAR wallet tile opens the NEAR Connect wallet list.
import { test, expect } from '@playwright/test';

async function openList(page, path, errors) {
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(path);
  await expect(page.getByTestId('hud-connect')).toHaveText('Sign in', { timeout: 30_000 });
  // Sign in opens the /setup stepper; its NEAR wallet tile opens the NEAR Connect list.
  await page.getByTestId('hud-connect').click();
  await expect(page).toHaveURL(/\/setup\//);
  await page.getByTestId('setup-wallet').click();
  await expect(page.locator('.connect-item').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.connect-item', { hasText: 'Meteor Wallet' })).toBeVisible();
}

for (const path of ['/']) {
  test(`connect: ${path} opens the NEAR Connect wallet list`, async ({ page }) => {
    const errors = [];
    await openList(page, path, errors);
    await expect(page.locator('.connect-item', { hasText: 'Ledger' })).toBeVisible();
    await expect(page.locator('.connect-item', { hasText: 'MyNearWallet' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
