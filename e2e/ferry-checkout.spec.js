import { test, expect } from '@playwright/test';

const deposit = 'ab'.repeat(32);
const chainTx = '5'.repeat(44);

test('ferry checkout: mocked 1Click returns a deposit address only after the charter allows it', async ({ page }) => {
  await page.route('**/api/mainnet', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ status: 'deployed', charter: { contract: 'charter.nearcarta.near', clause_pay: { receivers: ['payee.near'] } } }),
  }));
  await page.route('**/api/ferry/rules**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, charter: 'charter.nearcarta.near', receivers: ['payee.near'], settlement_yocto: '1000000000000000000000', frozen: false }),
  }));
  let body = null;
  await page.route('**/api/ferry/checkout', async route => {
    body = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true, depositAddress: deposit, depositMemo: null, status: 'PENDING_DEPOSIT', usd: '0.2',
        help: 'Waiting for your deposit to arrive.',
        receipt: { rail: 'intents', network: 'mainnet', what: 'checkout deposit address', to: 'payee.near', amount: '0.2', asset: 'USD', decision: 'allowed', reason: null, decided_by: 'charter', tx: deposit, url: null, checks: { charter: true, within_allowance: true, tee: null } },
      }),
    });
  });
  await page.route('**/api/ferry/status**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ status: 'SUCCESS', help: 'Done: the output was delivered.', final: true, tx: chainTx, depositAddress: deposit }),
  }));
  await page.goto('/ferry-widget');
  await expect(page.getByTestId('widget-embed')).toContainText('ferry-pay.js');
  await expect(page.getByTestId('widget-recipient')).toHaveValue('payee.near', { timeout: 15_000 });
  await page.getByTestId('widget-refund').fill('0x552ad18e18a49ddad1e7d96b7ddf813b04a9cfb5');
  await page.getByTestId('widget-pay').click();
  await expect(page.getByTestId('widget-deposit')).toHaveText(deposit);
  await expect(page.getByTestId('widget-status')).toContainText('Done', { timeout: 15_000 });
  await expect(page.getByTestId('widget-status').locator('a.tx')).toHaveAttribute('href', new RegExp(chainTx));
  expect(body.recipient).toBe('payee.near');
  expect(body.to).toEqual({ symbol: 'USDC', chain: 'near' });
  expect(Number(body.amount)).toBeLessThanOrEqual(0.2);
});

test('ferry checkout: a charter refusal shows no deposit address', async ({ page }) => {
  await page.route('**/api/mainnet', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ charter: { contract: 'charter.nearcarta.near' } }),
  }));
  await page.route('**/api/ferry/rules**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, receivers: ['payee.near'], settlement_yocto: '1000000000000000000000' }),
  }));
  await page.route('**/api/ferry/checkout', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, reason: 'receiver_not_allowlisted', depositAddress: null, receipt: { rail: 'intents', decision: 'refused', tx: null } }),
  }));
  await page.goto('/ferry-widget?recipient=other.near');
  await expect(page.getByTestId('widget-recipient')).toHaveValue('other.near');
  await page.getByTestId('widget-refund').fill('0x552ad18e18a49ddad1e7d96b7ddf813b04a9cfb5');
  await page.getByTestId('widget-pay').click();
  await expect(page.getByTestId('widget-out')).toContainText('receiver_not_allowlisted');
  await expect(page.getByTestId('widget-out')).toContainText('No deposit address');
  await expect(page.getByTestId('widget-deposit')).toHaveCount(0);
});
