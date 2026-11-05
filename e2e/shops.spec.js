import { test, expect } from '@playwright/test';
import dep from '../shared/deployments/mainnet.json' with { type: 'json' };
import { otherNet, otherEvm, retiredNet } from '../shared/net/word-scan.js';

test('health: the journey chain is mainnet and the API cannot sign', async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  expect(h.network).toEqual({ contracts: 'mainnet', journey: 'mainnet' });
  expect(h.near.chain_id).toBe('mainnet');
  if (h.near.height != null) expect(h.near.height).toBeGreaterThan(200_000_000);
  expect(h.features.signing).toBe(false);
  expect(h.trial).toBeFalsy();
});

test('ferry: dry 1Click quote USDC (Base) -> ZEC to a shielded address passes all checks', async ({ page }) => {
  await page.goto('/console#ferry');
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
  await page.goto('/console#ferry');
  await page.getByRole('button', { name: 'Fill sample addresses' }).click();
  await page.locator('select[name=privacy]').selectOption('basic');
  await page.getByRole('button', { name: 'Get dry quote' }).click();
  await expect(page.getByTestId('verdict')).toHaveText('ACCEPTED', { timeout: 30_000 });
  await expect(page.getByTestId('quote')).toContainText('privacy basic');
});

test('ferry: a transparent Zcash address is flagged as public', async ({ page }) => {
  await page.goto('/console#ferry');
  await page.getByRole('button', { name: 'Fill sample addresses' }).click();
  await page.locator('input[name=recipient]').fill('t1Nk7gi97dKeY7WAU3ryJnSDCoqp7VDaXzC');
  await page.locator('input[name=recipient]').dispatchEvent('change');
  await expect(page.getByTestId('zec-check')).toContainText('public on Zcash');
});

test('guardhouse: oath account has no full-access key and a propose-only agent key', async ({ page }) => {
  await page.goto('/console#guardhouse');
  // Accounts show a readable name; the full id is the link title and target.
  await expect(page.getByTestId('oath-state').locator(`a[title="${dep.board.contract}"]`).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('fak')).toHaveText('0');
  await expect(page.getByTestId('oath-state')).toContainText('propose');
});

test('guardhouse: NEAR AI TEE preflight verifies gateway and model quotes for a browser nonce', async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(!(await (await page.request.get('/api/health')).json()).features.nearAi, 'no NEAR AI key on this deploy');
  await page.goto('/console#guardhouse');
  await page.getByTestId('tee-btn').click();
  const v = page.getByTestId('tee-verdict');
  await expect(v).toBeVisible({ timeout: 60_000 });
  await expect(v).toHaveAttribute('data-ok', 'true');
  await expect(page.locator('#tee-out [data-check="fail"]')).toHaveCount(0);
  expect(await page.locator('#tee-out [data-check="pass"]').count()).toBeGreaterThanOrEqual(18);
});

test('chronicle: the guardhouse shows one allowed and one denied proposal from chain', async ({ page }) => {
  await page.goto('/console#chronicle');
  const c = page.getByTestId('chronicle');
  await expect(c).toContainText('propose', { timeout: 60_000 });
  await expect(c).toContainText('allowed'); await expect(c).toContainText('denied');
});

test('town hall: the page names the mainnet contract and says a shared DAO is not built', async ({ page }) => {
  await page.goto('/console#townhall');
  await expect(page.getByTestId('hall-state')).toContainText('shared DAO is not built', { timeout: 30_000 });
  await expect(page.getByTestId('hall-state').locator(`a[title="${dep.extras.townhall.contract}"]`).first()).toBeVisible();
});

test('arena: guardian g1 and its case tokens are read from chain', async ({ page }) => {
  await page.goto('/console#arena');
  await expect(page.getByTestId('arena-state').locator(`a[title="${dep.extras.arena.contract}"]`).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#arena')).toContainText('AZWxqZns');
});

test('toll: the page shows the mainnet contract and the Base address', async ({ page }) => {
  await page.goto('/console#toll');
  await expect(page.getByTestId('toll-state')).toContainText('8453', { timeout: 30_000 });
  await expect(page.locator('#toll')).toContainText(dep.toll.contract);
});

test('shop interiors get live data through the data interface', async ({ page }) => {
  await page.goto('/design/D8_shops/?2d');
  // QUOTE is no longer fetched here (the Ferry room reads its own quote), so only the chain reads are checked.
  const d = await page.evaluate(async () => { const m = await import('/design/D6_dashboards/src/data.js'); return { oath: m.CORE.oath, n: m.CORE_TXS.length, ag: m.AGENT_NAME }; });
  expect(d.oath).toBe(dep.charter.contract);
  expect(d.n).toBeGreaterThan(0); expect(d.ag).toBe('the Lamplighter');
  await page.getByRole('button', { name: 'Ferry' }).click();
  await expect(page.locator('#t-title')).toHaveText('Ferry');
});

test('mist bank: the street shows a hidden amount and only the commitment is public', async ({ page, request }) => {
  const m = await (await request.get('/api/mistbank')).json();
  expect(m.network).toBe('mainnet');
  expect(JSON.stringify(m)).not.toMatch(new RegExp('uview|salt=|"zats"|' + otherNet.source, 'i'));
  expect(m.note).toMatch(/0\.005/);
  await page.goto('/design/D8_shops/?2d');
  const b = await page.evaluate(async () => (await import('/design/D6_dashboards/src/data.js')).BANK);
  expect(b == null || b.src === 'mainnet').toBe(true);
  if (b) expect(JSON.stringify(b)).not.toMatch(new RegExp(otherNet.source + '|uview|ufvk|salt=', 'i'));
});

test('town view loads', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/design/D9_world/');
  await page.waitForFunction(() => window.__ready === true || document.querySelector('canvas'), null, { timeout: 45_000 });
  expect(errors).toEqual([]);
});
