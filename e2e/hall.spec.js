import { test, expect } from '@playwright/test';

test('a preview flag does not open the demo row', async ({ page }) => {
  await page.goto('/shops/hall/?preview=1');
  await expect(page).not.toHaveURL(/preview=1/);
  await expect(page.getByTestId('hall-preview')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('preview.near');
  await expect(page.getByTestId('hall-cta')).toHaveText('Post job');
});

test('the post button asks for a task and does not sign', async ({ page }) => {
  await page.goto('/shops/hall/');
  await expect(page.getByTestId('hall-cta')).toHaveText('Post job');
  await page.getByTestId('hall-cta').click();
  await expect(page.getByTestId('hall-status').first()).toContainText('Nothing was signed');
  await expect(page.locator('body')).not.toContainText('Prepared 0');
});
