import { test, expect } from '@playwright/test';
// Town Hall proposals page (/shops/hall/). The read-only test runs always; filing a real
// add_proposal (0.1 NEAR testnet bond from a fresh faucet account) needs HALL_FILE=1.
test.describe('town hall proposals', () => {
  test('shows the DAO, its council and the latest proposals from chain', async ({ page }) => {
    await page.goto('/shops/hall/');
    await expect(page.locator('#facts')).toContainText('r7thmvr8maey.sputnikv2.testnet', { timeout: 60_000 });
    await expect(page.locator('#facts')).toContainText('Anyone may file a proposal');
    await expect(page.locator('[data-testid=list] li').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('file')).toBeDisabled();
  });
  test('a guest files a proposal to join the reward list', async ({ page }) => {
    test.skip(!process.env.HALL_FILE, 'set HALL_FILE=1 to file a real testnet proposal');
    page.on('dialog', d => d.accept());
    await page.goto('/shops/hall/');
    await page.getByTestId('guest').click();
    await expect(page.getByTestId('who')).toContainText('ncguest-', { timeout: 120_000 });
    await page.getByTestId('desc').fill('e2e: add this guest account to the Town Hall reward list');
    await page.getByTestId('file').click();
    const filed = page.getByTestId('filed');
    await expect(filed).toBeVisible({ timeout: 120_000 });
    expect(await filed.getAttribute('data-tx')).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    const id = await filed.getAttribute('data-id');
    await expect(page.locator(`[data-testid=list] li[data-id="${id}"]`)).toContainText('InProgress');
  });
});
