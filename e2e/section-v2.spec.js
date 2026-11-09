// Session length on /setup. Preview signs nothing.
import { test, expect } from '@playwright/test';

test('a board session is 1, 2 or 24 hours and the agent key names propose_call', async ({ page }) => {
  await page.goto('/setup/?preview=1#rules');
  await expect(page.getByTestId('preview-banner')).toBeVisible();
  const hours = page.getByTestId('rule-hours');
  await expect(hours).toBeVisible();
  await expect(hours.locator('option')).toHaveText(['1 hour', '2 hours', '24 hours']);
  await expect(hours).toHaveValue('1');
  await hours.selectOption('24');
  await expect(page.getByTestId('rule-preview')).toContainText('for 24 hours');
  await page.goto('/setup/?preview=1#sign');
  await expect(page.getByTestId('setup-key-scope')).toContainText('propose_call_as');
  await expect(page.getByTestId('setup-key-scope')).toContainText('propose_call');
  await expect(page.getByTestId('sign-cost')).toContainText('0.05 for the shop allowlist');
  // The caps are on the page before the wallet opens, not only inside the wallet.
  const caps = page.getByTestId('setup-caps');
  await expect(caps).toBeVisible();
  await expect(page.getByTestId('cap-per')).toContainText('NEAR');
  await expect(page.getByTestId('cap-daily')).toContainText('NEAR');
  await expect(page.getByTestId('cap-count')).not.toBeEmpty();
  await expect(page.getByTestId('cap-receivers')).not.toBeEmpty();
  await expect(page.getByTestId('cap-session')).toContainText('hour');
});
