// Wallet connect through NEAR Connect, without signing: the town and the console show "Connect wallet",
// clicking it opens the NEAR Connect wallet list. MyNearWallet is listed (testnet, "ends 31 Oct") until its
// sunset on 31 Oct 2026, 00:00 Cairo; from then on it is only in the greyed list with that reason.
import { test, expect } from '@playwright/test';

const SUNSET = new Date('2026-10-31T00:00:00+03:00');

async function openList(page, path, errors) {
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(path);
  await expect(page.locator('#wallet').getByRole('button', { name: 'Start free' })).toBeVisible({ timeout: 30_000 });
  await page.locator('#wallet').getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.locator('.connect-item').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.connect-item', { hasText: 'Meteor Wallet' })).toBeVisible();
}

for (const path of ['/', '/console']) {
  test(`connect: ${path} opens the NEAR Connect wallet list`, async ({ page }) => {
    const errors = [];
    await page.clock.setFixedTime(new Date(SUNSET.getTime() - 60_000));
    await openList(page, path, errors);
    await expect(page.locator('.connect-item', { hasText: 'MyNearWallet (testnet, ends 31 Oct)' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`connect: ${path} drops MyNearWallet after its sunset`, async ({ page }) => {
    const errors = [];
    await page.clock.setFixedTime(SUNSET);
    await openList(page, path, errors);
    await expect(page.locator('.connect-item', { hasText: 'MyNearWallet' })).toHaveCount(0);
    await expect(page.locator('[data-testid=wallets-unavailable] [data-wallet="MyNearWallet"]')).toContainText('Sunset');
    expect(errors).toEqual([]);
  });
}
