import { test, expect } from '@playwright/test';
import dep from '../shared/deployments/testnet.json' with { type: 'json' };

test('health: the API reads NEAR testnet and cannot sign', async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  expect(h.network).toBe('testnet'); expect(h.near.height).toBeGreaterThan(200_000_000); expect(h.features.signing).toBe(false);
});

test('ferry: dry 1Click quote USDC (Base) -> ZEC to a shielded address passes all checks', async ({ page }) => {
  await page.goto('/#ferry');
  await expect(page.locator('input[name=recipient]')).toHaveValue(''); await expect(page.locator('input[name=amount]')).toHaveValue('30');
  await page.getByRole('button', { name: 'Fill sample addresses' }).click();
  await expect(page.getByTestId('zec-check')).toContainText('shielded');
  await page.getByRole('button', { name: 'Get dry quote' }).click();
  const q = page.getByTestId('quote');
  await expect(q).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('verdict')).toHaveText('ACCEPTED');
  await expect(q.locator('[data-check=fail]')).toHaveCount(0);
  await expect(q.locator('[data-check=pass]')).toHaveCount(3);
});

test('ferry: confidential (basic) quote echoes the privacy level', async ({ page }) => {
  test.skip(!(await (await page.request.get('/api/health')).json()).features.confidentialQuotes, 'no partner key on this deploy');
  await page.goto('/#ferry');
  await page.getByRole('button', { name: 'Fill sample addresses' }).click();
  await page.locator('select[name=privacy]').selectOption('basic');
  await page.getByRole('button', { name: 'Get dry quote' }).click();
  await expect(page.getByTestId('verdict')).toHaveText('ACCEPTED', { timeout: 30_000 });
  await expect(page.getByTestId('quote')).toContainText('privacy basic');
});

test('ferry: a transparent Zcash address is flagged as public', async ({ page }) => {
  await page.goto('/#ferry');
  await page.getByRole('button', { name: 'Fill sample addresses' }).click();
  await page.locator('input[name=recipient]').fill('t1Nk7gi97dKeY7WAU3ryJnSDCoqp7VDaXzC');
  await page.locator('input[name=recipient]').dispatchEvent('change');
  await expect(page.getByTestId('zec-check')).toContainText('public on Zcash');
});

test('guardhouse: oath account has no full-access key and a propose-only agent key', async ({ page }) => {
  await page.goto('/#guardhouse');
  // Accounts show a readable name; the full id is the link title and target.
  await expect(page.getByTestId('oath-state').locator(`a[title="${dep.guardhouse.oath}"]`).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('fak')).toHaveText('0');
  await expect(page.getByTestId('oath-state')).toContainText('propose');
});

test('guardhouse: NEAR AI TEE preflight verifies gateway and model quotes for a browser nonce', async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(!(await (await page.request.get('/api/health')).json()).features.nearAi, 'no NEAR AI key on this deploy');
  await page.goto('/#guardhouse');
  await page.getByTestId('tee-btn').click();
  const v = page.getByTestId('tee-verdict');
  await expect(v).toBeVisible({ timeout: 60_000 });
  await expect(v).toHaveAttribute('data-ok', 'true');
  await expect(page.locator('#tee-out [data-check="fail"]')).toHaveCount(0);
  expect(await page.locator('#tee-out [data-check="pass"]').count()).toBeGreaterThanOrEqual(18);
});

test('chronicle: the guardhouse shows one allowed and one denied proposal from chain', async ({ page }) => {
  await page.goto('/#chronicle');
  const c = page.getByTestId('chronicle');
  await expect(c).toContainText('propose', { timeout: 60_000 });
  await expect(c).toContainText('allowed'); await expect(c).toContainText('denied');
});

test('town hall: oath is frozen by a DAO vote', async ({ page }) => {
  await page.goto('/#townhall');
  await expect(page.getByTestId('hall-state')).toContainText('frozen by a DAO vote', { timeout: 30_000 });
  await expect(page.getByTestId('hall-state').locator(`a[title="${dep.townhall.dao}"]`).first()).toBeVisible();
});

test('arena: guardian g1 and its case tokens are read from chain', async ({ page }) => {
  await page.goto('/#arena');
  await expect(page.getByTestId('arena-state').locator(`a[title="${dep.arena.contract}"]`).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#arena')).toContainText('case:C1_CAP');
});

test('toll: Chain Signatures oath shows its Base Sepolia address and a signed tx', async ({ page }) => {
  await page.goto('/#toll');
  await expect(page.getByTestId('toll-state')).toContainText('84532', { timeout: 30_000 });
  await expect(page.locator('#toll')).toContainText('0x552ad18e');
});

test('shop interiors get live data through the data interface', async ({ page }) => {
  await page.goto('/design/D8_shops/?2d');
  const d = await page.evaluate(async () => { const m = await import('/design/D6_dashboards/src/data.js'); return { q: m.QUOTE, oath: m.CORE.oath, n: m.CORE_TXS.length, ag: m.AGENT_NAME }; });
  expect(d.oath).toBe(dep.guardhouse.oath); expect(d.q.src).toBe('live'); expect(d.q.fee).toContain('signature verified');
  expect(d.n).toBeGreaterThan(0); expect(d.ag).toBe('the Lamplighter');
  await page.getByRole('button', { name: 'Ferry' }).click();
  await expect(page.locator('#t-title')).toHaveText('Ferry');
});

test('mist bank: the street shows a hidden amount and only the commitment is public', async ({ page, request }) => {
  const m = await (await request.get('/api/mistbank')).json();
  expect(m.street.amount_hidden).toBe(true); expect(m.oath.memo_on_chain).toBe(true);
  expect(JSON.stringify(m)).not.toMatch(/uview(test)?1|salt=|"zats"/); expect(m.binding.charter_caps_zec_amount).toBe(false);
  expect(m.payout.txid).toBe(dep.mistbank.payout.txid);
  await page.goto('/design/D8_shops/?2d');
  const b = await page.evaluate(async () => (await import('/design/D6_dashboards/src/data.js')).BANK);
  expect(b.src).toBe('testnet'); expect(b.street.hidden).toBe(true); expect(b.commitment.value).toBe(m.commitment.value);
  expect(JSON.stringify(b)).not.toMatch(/uview|ufvk|salt=|"salt"|"zats"|"taz"|"amount"/i);
});

test('town view loads', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/design/D9_world/');
  await page.waitForFunction(() => window.__ready === true || document.querySelector('canvas'), null, { timeout: 45_000 });
  expect(errors).toEqual([]);
});
