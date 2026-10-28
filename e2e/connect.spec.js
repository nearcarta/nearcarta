// Wallet connect through NEAR Connect, without signing: the town and the console show "Connect wallet",
// clicking it opens the NEAR Connect wallet list, and nothing on the page points at MyNearWallet.
import { test, expect } from '@playwright/test';

for (const path of ['/', '/console']) {
  test(`connect: ${path} opens the NEAR Connect wallet list`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(path);
    const btn = page.locator('#wallet').getByRole('button', { name: 'Connect wallet' });
    await expect(btn).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#wallet a', { hasText: 'Free testnet NEAR' })).toHaveAttribute('href', /docs\.near\.org\/getting-started\/faucet/);
    await btn.click();
    await expect(page.getByText('Select wallet', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Meteor Wallet', { exact: true })).toBeVisible();
    expect(await page.content()).not.toMatch(/mynearwallet/i);
    expect(errors).toEqual([]);
  });
}
