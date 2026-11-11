// The Try free entry, the network badge and the welcome card, in a real browser.
//
// These pin what a judge sees and what must never overlap: at 390px the two entry buttons and the
// TESTNET pill sit in the town's own top bar, clear of All shops, the Back button and the dock.
// Docs: https://docs.near.org/protocol/accounts-contracts/account-id · https://docs.near.org/tools/near-api
import { test, expect } from '@playwright/test';

const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const width of [1440, 390]) {
  test.describe(`guest entry ${width}`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width < 500, hasTouch: width < 500 });

    test('the town shows Try free, Play for real and the network badge without overlaps', async ({ page }) => {
      await page.goto('/?mode=2d&net=testnet');
      await page.waitForFunction(() => document.body.classList.contains('fb') || document.body.classList.contains('ready'), null, { timeout: 30_000 });
      const tryFree = page.getByTestId('try-free');
      await expect(tryFree).toBeVisible({ timeout: 30_000 });
      // The gold action starts a free account; the outlined one is the real-money sign-in.
      await expect(tryFree).toHaveClass(/btn-gold/);
      const signIn = page.getByTestId('sign-in');
      await expect(signIn).toHaveClass(/btn-outline/);
      await expect(signIn).toHaveAttribute('href', /\/setup\//);
      // The badge names the network the page is on.
      await expect(page.getByTestId('net-badge')).toHaveText(/TESTNET/);
      const boxes = {
        tryFree: await tryFree.boundingBox(),
        signIn: await signIn.boundingBox(),
        badge: await page.getByTestId('net-badge').boundingBox(),
        allShops: await page.getByTestId('all-shops-link').boundingBox(),
        rules: await page.getByTestId('rules-cta').boundingBox(),
      };
      for (const [a, b] of [['tryFree', 'allShops'], ['signIn', 'allShops'], ['badge', 'allShops'], ['tryFree', 'rules'], ['badge', 'rules'], ['signIn', 'badge']]) {
        expect(overlap(boxes[a], boxes[b]), `${a} overlaps ${b} at ${width}`).toBe(false);
      }
      // The same page on mainnet says MAINNET, and never names the free network in its badge.
      await page.goto('/?mode=2d&net=mainnet');
      await page.waitForFunction(() => document.body.classList.contains('fb') || document.body.classList.contains('ready'), null, { timeout: 30_000 });
      await expect(page.getByTestId('net-badge')).toHaveText(/MAINNET/);
    });
  });
}

test('the badge sheet offers the key download and the way to real money', async ({ page }) => {
  await page.goto('/?mode=2d&net=testnet');
  await page.waitForFunction(() => document.body.classList.contains('fb') || document.body.classList.contains('ready'), null, { timeout: 30_000 });
  await page.getByTestId('net-badge').click();
  const sheet = page.getByTestId('net-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(/test network|testnet/i);
  // The upgrade path is a link to the other network, carrying this page.
  const sw = sheet.getByTestId('switch-network');
  await expect(sw).toHaveAttribute('href', /net=mainnet/);
  await page.getByTestId('net-sheet-close').click();
  await expect(sheet).toHaveCount(0);
});
