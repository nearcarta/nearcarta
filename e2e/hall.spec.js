import { test, expect } from '@playwright/test';

test('a preview flag does not open the demo row', async ({ page }) => {
  await page.goto('/shops/hall/?preview=1');
  await expect(page).not.toHaveURL(/preview=1/);
  await expect(page.getByTestId('hall-preview')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('preview.near');
  await expect(page.locator('#cap, [data-testid=hall-cap]')).not.toHaveValue('0.002');
});

test('the sign button is present and does not send when no row is loaded', async ({ page }) => {
  await page.goto('/shops/hall/');
  await expect(page.getByTestId('hall-apply')).toHaveText('Sign');
  await page.getByTestId('hall-apply').click();
  await expect(page.getByTestId('hall-norow')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Prepared 0');
});
