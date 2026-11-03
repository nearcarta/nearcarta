// The EVM wallet opens the evm-on-near.dev window, and a blocked pop-up shows its error instead of doing nothing.
import { test, expect } from '@playwright/test';

for (const blocked of [false, true]) {
  test(`evm wallet: ${blocked ? 'blocked pop-up shows an error' : 'opens the evm-on-near.dev window'}`, async ({ page, context }) => {
    await context.addInitScript(b => { if (location.origin === 'https://evm-on-near.dev') return; if (b) window.open = () => null; }, blocked);
    await page.goto('/setup/');
    const pop = blocked ? null : context.waitForEvent('page');
    await page.getByTestId('setup-metamask').click();
    if (blocked) await expect(page.getByTestId('setup-err')).toContainText(/pop-?up/i, { timeout: 20000 });
    else expect((await pop).url()).toContain('https://evm-on-near.dev/');
  });
}
