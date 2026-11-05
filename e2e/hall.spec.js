import { test, expect } from '@playwright/test';

test('a preview row reads the new cap back after reload', async ({ page }) => {
  await page.goto('/shops/hall/?preview=1');
  await expect(page.getByTestId('hall-preview')).toBeVisible();
  await expect(page.getByTestId('hall-facts')).toContainText('preview.near');
  await expect(page.locator('body')).not.toContainText('sputnik');
  await expect(page.locator('body')).not.toContainText('add_proposal');
  await page.getByTestId('hall-cap').fill('0.003');
  await page.getByTestId('hall-apply').click();
  await expect(page.getByTestId('hall-readback')).toContainText('0.003');
  await expect(page.getByTestId('diff-lines')).toContainText('per_action_cap');
  await page.reload();
  await expect(page.getByTestId('hall-read')).toContainText('0.003');
});
