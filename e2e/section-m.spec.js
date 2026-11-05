import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  expect(h.network?.contracts).toBe('mainnet');
  expect(h.features?.signing).toBe(false);
});

async function shot(page, name) {
  for (let i = 0; i < 2; i++) {
    try { await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false }); return; }
    catch (e) { if (i) throw e; }
  }
}

test('M1 the bank TEE check names a pass or the failing step', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/shops/bank/');
  const tee = page.waitForResponse(r => r.url().includes('/api/ai/tee'), { timeout: 60_000 });
  await page.getByTestId('tee-verify').click();
  const res = await tee;
  expect(res.status()).toBeLessThan(500);
  const result = page.getByTestId('tee-result');
  await expect(result).toHaveText(/attested|failed/, { timeout: 60_000 });
  const label = await result.innerText();
  if (label.trim() === 'failed') await expect(page.getByTestId('tee-fail')).toContainText(/:/);
  else await expect(page.getByTestId('tee-live')).toContainText('Live check passed');
  await expect(page.getByTestId('tee-step').first()).toBeVisible();
  await shot(page, 'm1-bank-tee-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'm1-bank-tee-390');
});

test('M2 another attack changes the prompt and does not ask the vault', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let asked = false;
  page.on('request', r => { if (r.url().includes('/api/vault/ask')) asked = true; });
  await page.goto('/shops/arena/');
  const first = await page.getByTestId('arena-attack').innerText();
  expect(first.length).toBeGreaterThan(10);
  await page.getByTestId('redteam-next').click();
  await expect(page.getByTestId('arena-attack')).not.toHaveText(first);
  expect(asked).toBe(false);
  await shot(page, 'm2-arena-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'm2-arena-390');
});

test('M3 a blank payee prepares nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/shops/payouts/');
  await expect(page.getByTestId('payout-to')).toHaveCount(2);
  await page.getByTestId('payout-prepare').click();
  await expect(page.getByTestId('payout-receipt')).toHaveCount(0);
  await expect(page.getByTestId('payout-drop')).toContainText(/payee/i);
  await shot(page, 'm3-payouts-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'm3-payouts-390');
});

test('M4 one session on the chip, the hall and the bank', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nearcarta.setup.v1', JSON.stringify({ accountId: 'visitor.near', displayName: 'Scholar', balanceNear: 1, step: 6 }));
    localStorage.setItem('nearcarta.hero.v1', JSON.stringify({ name: 'Scholar', img: 'mage', dye: '#d6b46a' }));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/shops/hall/');
  await expect(page.getByTestId('hall-facts')).toContainText('Signed in as Scholar');
  await expect(page.getByTestId('connect')).toBeHidden();
  await shot(page, 'm4-hall-1440');
  await page.goto('/shops/bank/');
  await expect(page.getByTestId('bank-session')).toContainText('Signed in as Scholar');
  await expect(page.getByTestId('bank-to')).not.toContainText('Sign in to choose a payee');
  await expect(page.getByTestId('bank-to')).toContainText('visitor.near');
  await shot(page, 'm4-bank-1440');
  await page.goto('/?mode=2d&nostory');
  await expect(page.getByTestId('hero-chip')).toContainText('Scholar', { timeout: 20_000 });
  await expect(page.getByTestId('hero-chip')).toHaveAttribute('data-signed', '1');
  await shot(page, 'm4-town-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/shops/hall/');
  await expect(page.getByTestId('connect')).toBeHidden();
  await shot(page, 'm4-hall-390');
});

test('M5 setup can jump back to step 1', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/setup/?preview=1#try');
  await expect(page.getByTestId('setup-steps')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('setup-step').first().click();
  await expect(page.locator('.eyebrow')).toContainText('Step 1 of 7');
  await shot(page, 'm5-setup-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/setup/?preview=1#try');
  await expect(page.getByTestId('setup-step').first()).toBeVisible();
  await page.getByTestId('setup-step').first().click();
  await expect(page.locator('.eyebrow')).toContainText('Step 1 of 7');
  await page.getByTestId('setup-steps').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/m5-setup-390.png`, fullPage: true });
});

test('M6 the loading card is up before the intro', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'commit' });
  const card = page.locator('#loading .lc');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Opening the town');
  await expect(page.locator('#loading')).not.toHaveClass(/done/);
  await shot(page, 'm6-loading-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#loading .lc')).toBeVisible();
  await shot(page, 'm6-loading-390');
});

test('M7 ferry idle does not invent a quote or a deposit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/shops/ferry/');
  await expect(page.getByTestId('ferry-idle')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Waiting for the deposit');
  const idle = await page.getByTestId('ferry-idle').innerText();
  expect(idle).toMatch(/No quote yet|No deposit has been requested/);
  const usd = await page.getByTestId('ferry-usd').first().innerText();
  if (/No quote yet/.test(idle)) expect(usd).toBe('No quote yet');
  await shot(page, 'm7-ferry-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'm7-ferry-390');
});

test('M8 guardhouse names the empty hash and the missing first-seen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/shops/guard/');
  await page.getByTestId('guard-account').fill('nearcarta.near');
  await page.getByTestId('guard-check').click();
  await expect(page.getByTestId('guard-verdict')).toHaveText('warn', { timeout: 30_000 });
  const reasons = page.getByTestId('guard-reason');
  await expect(reasons.filter({ hasText: 'no contract' })).toHaveCount(1);
  await expect(reasons.filter({ hasText: 'first-seen' })).toHaveCount(1);
  await shot(page, 'm8-guard-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'm8-guard-390');
});

test('M10 the console does not say a DAO governs the oath', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/console');
  await expect(page.locator('h1, .top, body').first()).toBeVisible();
  await page.getByRole('button', { name: 'Town Hall' }).click();
  await expect(page.getByTestId('hall-state')).toContainText('A shared DAO is not built', { timeout: 30_000 });
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/DAO-governed oath/);
  expect(text).not.toMatch(/Town Hall DAO/);
  await shot(page, 'm10-console-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'm10-console-390');
});
