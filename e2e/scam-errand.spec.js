// The scam errand on the front door: the card is there, it says what it will do, and it never covers the
// town's own gold action. The live receipts need the testnet service, so they are covered by
// scripts/scam-e2e.mjs (both hashes, non-zero exit when one is missing), not by this browser test.
// Docs: https://docs.near.ai/cloud/verification/reference/response-signature-verification
import { test, expect } from '@playwright/test';

const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const width of [1440, 390]) {
  test.describe(`scam errand ${width}`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width < 500, hasTouch: width < 500 });

    test('the errand is on the front door and clear of the town gold action', async ({ page }) => {
      await page.goto('/?mode=2d&net=testnet');
      await expect(page.getByTestId('scam-errand')).toBeVisible({ timeout: 15_000 });
      // It says what it is and what the two controls do.
      await expect(page.getByTestId('scam-errand')).toContainText(/talk a keeper past/i);
      await expect(page.getByTestId('scam-ask')).toBeVisible();
      // The forced submit only appears after a refusal is anchored, so it starts hidden.
      await expect(page.getByTestId('scam-force')).toBeHidden();
      // One example pre-fills the box, so a visitor can act without typing.
      await page.getByTestId('scam-example-1').click();
      await expect(page.getByTestId('scam-text')).toHaveValue(/95% off/);
      // Never on top of the dock, All shops, or the town's own gold CTA.
      const card = await page.getByTestId('scam-errand').boundingBox();
      const boxes = {
        dock: await page.locator('#ctl').boundingBox(),
        shops: await page.locator('nav.all-shops').boundingBox(),
        rules: await page.locator('#rulesBtn').boundingBox(),
      };
      for (const [name, box] of Object.entries(boxes)) {
        expect(overlap(card, box), `the errand covers ${name} at ${width}`).toBe(false);
      }
    });
  });
}

test('the errand explains itself on mainnet instead of pretending to work', async ({ page }) => {
  await page.goto('/?mode=2d&net=mainnet');
  await expect(page.getByTestId('scam-errand')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('scam-errand')).toContainText(/test network|net=testnet/i);
  await expect(page.getByTestId('scam-ask')).toBeDisabled();
});
