// The EVM wallet opens the evm-on-near.dev window, and a blocked pop-up shows its error instead of doing nothing.
import { test, expect } from '@playwright/test';

for (const blocked of [false, true]) {
  test(`evm wallet: ${blocked ? 'blocked pop-up shows an error' : 'opens the evm-on-near.dev window'}`, async ({ page, context }) => {
    await context.addInitScript(b => { if (location.origin === 'https://evm-on-near.dev') return; if (b) window.open = () => null; }, blocked);
    await page.goto('/console');
    await page.locator('#wallet button', { hasText: 'Connect wallet' }).click();
    const pop = blocked ? null : context.waitForEvent('page');
    await page.getByText(/MetaMask & EVM wallets/).first().click();
    const note = page.getByTestId('wallet-note');
    if (blocked) await expect(note).toContainText('Popup blocked', { timeout: 20000 });
    else { expect((await pop).url()).toContain('https://evm-on-near.dev/'); await expect(note).toContainText('Connect Wallet'); }
  });
}
