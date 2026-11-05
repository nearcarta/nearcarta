// Onboarding, every shop, both widths. Preview mode signs nothing.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { otherNet, otherEvm, retiredNet } from '../shared/net/word-scan.js';

const shots = process.env.SHOTS_DIR || '/opt/cursor/artifacts/screenshots';
mkdirSync(shots, { recursive: true });
const steps = ['signin', 'fund', 'privacy', 'character', 'rules', 'sign', 'try'];
const shops = ['house', 'toll', 'ferry', 'bank', 'guard', 'arena', 'hall', 'payouts', 'chronicle'];

for (const width of [1440, 390]) {
  test.describe(`onboarding ${width}`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width < 500, hasTouch: width < 500 });

    test('town pin opens setup and each step renders', async ({ page }) => {
      await page.goto('/?mode=2d');
      await page.waitForFunction(() => document.body.classList.contains('fb') || document.body.classList.contains('ready'), null, { timeout: 30_000 });
      const pin = page.getByTestId('rules-cta');
      await expect(pin).toBeVisible({ timeout: 30_000 });
      await expect(pin).toHaveAttribute('href', /\/setup\//);
      await page.screenshot({ path: `${shots}/town-${width}.png` });
      await pin.click();
      await expect(page).toHaveURL(/\/setup\//);
      await expect(page.getByRole('heading', { name: 'Start here.' })).toBeVisible();
      await expect(page.getByTestId('back-town')).toBeVisible();
      await expect(page.getByText('Connect wallet')).toHaveCount(0);
      await expect(page.getByTestId('setup-net')).toHaveText('mainnet');
      await expect(page.getByTestId('setup-choices')).not.toContainText(otherNet);
      await expect(page.getByTestId('setup-guest')).toHaveCount(0);

      for (const step of steps) {
        await page.goto(`/setup/?preview=1#${step}`);
        await expect(page.getByTestId('preview-banner')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('back-town')).toBeVisible();
        await expect(page.getByTestId('setup-net')).toHaveText('mainnet');
        if (step === 'fund') await expect(page.getByTestId('setup-faucet')).toHaveCount(0);
        if (step === 'signin') await expect(page.getByTestId('setup-choices')).not.toContainText(otherNet);
        if (step === 'character') {
          await expect(page.getByTestId('setup-portrait')).toBeVisible();
          await page.getByTestId('dye-sea').click();
          await expect(page.getByTestId('setup-portrait')).toHaveAttribute('style', /7eb8c9/);
          await page.getByTestId('outfit-cloak').click();
          await expect(page.getByTestId('setup-portrait')).toHaveAttribute('data-outfit', 'cloak');
        }
        if (step === 'try') await expect(page.getByTestId('setup-office')).toBeVisible();
        await page.screenshot({ path: `${shots}/setup-${step}-${width}.png`, fullPage: true });
      }
    });

    test('charter office has one sign-in and a real board', async ({ page }) => {
      await page.goto('/shops/vault/');
      await expect(page.getByTestId('connect')).toHaveText('Sign in');
      await expect(page.getByTestId('back-town')).toBeVisible();
      await expect(page.getByTestId('net-badge')).toContainText(/mainnet/);
      await page.getByTestId('tab-board').click();
      const board = page.getByRole('tabpanel', { name: 'Leaderboard' });
      await expect(board).toBeVisible();
      await expect(board).toContainText(/Visitor charters|unavailable/);
      await page.screenshot({ path: `${shots}/office-${width}.png`, fullPage: true });
    });

    test('proof drawer title is not under the header buttons', async ({ page }) => {
      await page.goto('/?mode=2d&shop=house');
      await page.waitForFunction(() => document.body.classList.contains('fb') || document.body.classList.contains('ready'), null, { timeout: 30_000 });
      await expect(page.locator('#t-title')).toBeVisible({ timeout: 30_000 });
      await page.locator('#t-proof').click();
      await expect(page.locator('#d-title')).toBeVisible();
      const acct = page.locator('#acct');
      if (await acct.count()) await expect(acct).toBeHidden();
      await page.screenshot({ path: `${shots}/drawer-${width}.png` });
    });

    test('every shop', async ({ page }) => {
      for (const shop of shops) {
        await page.goto(`/design/D8_shops/?2d&shop=${shop}`);
        await expect(page.locator('#t-title')).not.toHaveText('', { timeout: 30_000 });
        await expect(page.getByTestId('back-town')).toBeVisible();
        await page.screenshot({ path: `${shots}/shop-${shop}-${width}.png` });
      }
    });
  });
}
