import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });
const OWNER = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  expect(h.network?.contracts).toBe('mainnet');
  expect(h.features?.signing).toBe(false);
});

async function shot(page, name) {
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

async function at(page, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
}

function quietWallet() {
  window.__NC_ACCOUNT = async () => null;
}

function savedScholar(accountId) {
  localStorage.setItem('nearcarta.setup.v1', JSON.stringify({
    accountId, displayName: 'Scholar', balanceNear: 1, walletId: 'nearcarta-privy',
  }));
  window.__NC_ACCOUNT = async () => null;
}

async function noSideways(page) {
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(ok).toBe(true);
}

async function radiosBeside(page) {
  const pairs = page.locator('label:has(input[type=radio])');
  const n = await pairs.count();
  for (let i = 0; i < n; i++) {
    const label = pairs.nth(i);
    const radio = label.locator('input[type=radio]');
    const text = label.locator('span').first();
    if (await text.count() === 0) continue;
    if (!(await radio.isVisible()) || !(await text.isVisible())) continue;
    const r = await radio.boundingBox();
    const s = await text.boundingBox();
    expect(r).toBeTruthy();
    expect(s).toBeTruthy();
    expect(r.x + r.width).toBeLessThanOrEqual(s.x + 2);
    expect(s.x - (r.x + r.width)).toBeLessThan(28);
    expect(Math.abs((r.y + r.height / 2) - (s.y + s.height / 2))).toBeLessThan(14);
  }
}

test('O1 bank amount radios sit beside their labels', async ({ page }) => {
  await page.addInitScript(quietWallet);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/bank/');
    const notes = page.getByTestId('bank-notes');
    await expect(notes).toBeVisible();
    await expect(notes.locator('input[type=radio]')).toHaveCount(3);
    await radiosBeside(page);
    const first = await notes.locator('input').first().boundingBox();
    const card = await page.locator('.shop-card').boundingBox();
    expect(first.x).toBeLessThan(card.x + 48);
    await noSideways(page);
    await shot(page, 'o1-bank-' + width);
  }
});

test('O2 the hall row id is short and the card is one column', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/hall/?owner=' + OWNER);
    const id = page.getByTestId('hall-row-id');
    await expect(id).toHaveText('8e2027…61c8', { timeout: 30_000 });
    const box = await id.boundingBox();
    expect(box.height).toBeLessThan(36);
    const form = await page.getByTestId('hall-form').boundingBox();
    expect(form.width).toBeGreaterThan(width === 1440 ? 700 : 300);
    await radiosBeside(page);
    await noSideways(page);
    await shot(page, 'o2-hall-' + width);
  }
  await page.getByTestId('hall-copy').click();
  await expect(page.getByTestId('hall-copy')).toHaveText('Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(OWNER);
});

test('O3 arena actions have a gap and the attack box is tall', async ({ page }) => {
  await page.addInitScript(quietWallet);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/arena/');
    await page.getByRole('tab', { name: 'Attack' }).click();
    const run = page.getByTestId('redteam-run');
    const next = page.getByTestId('redteam-next');
    await expect(run).toBeVisible();
    await expect(next).toBeVisible();
    const a = await run.boundingBox();
    const b = await next.boundingBox();
    const sameRow = b.y < a.y + a.height;
    const gap = sameRow ? b.x - (a.x + a.width) : b.y - (a.y + a.height);
    expect(gap).toBeGreaterThanOrEqual(10);
    const box = await page.locator('#a-txt').boundingBox();
    expect(box.height).toBeGreaterThan(100);
    await noSideways(page);
    await shot(page, 'o3-arena-' + width);
  }
});

test('O4 ferry route buttons are brass cards', async ({ page }) => {
  await page.addInitScript(quietWallet);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/ferry/');
    const chips = page.getByTestId('ferry-route');
    await expect(chips).toHaveCount(3);
    await expect(page.getByTestId('ferry-compare')).toBeEnabled({ timeout: 60_000 });
    const idle = await chips.nth(1).evaluate(el => {
      const s = getComputedStyle(el);
      return { image: s.backgroundImage, color: s.color };
    });
    expect(idle.image).toContain('linear-gradient');
    expect(idle.color).toBe('rgb(255, 248, 238)');
    const on = await chips.nth(0).evaluate(el => {
      const s = getComputedStyle(el);
      return { image: s.backgroundImage, color: s.color, anim: s.animationName };
    });
    expect(on.color).toBe('rgb(42, 22, 8)');
    expect(on.anim).toBe('routeShine');
    expect(on.image).toContain('linear-gradient');
    await radiosBeside(page);
    await noSideways(page);
    await shot(page, 'o4-ferry-' + width);
  }
});

test('O5 payouts title, rows and CSV share one column', async ({ page }) => {
  await page.addInitScript(quietWallet);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/payouts/');
    await page.getByTestId('payout-add').click();
    const title = await page.locator('h1').boundingBox();
    const add = await page.getByTestId('payout-add').boundingBox();
    const csv = await page.getByTestId('payout-csv').boundingBox();
    const row = await page.locator('[data-testid=payout-list] li').boundingBox();
    expect(Math.abs(title.x - add.x)).toBeLessThan(6);
    expect(Math.abs(title.x - csv.x)).toBeLessThan(6);
    expect(Math.abs(title.x - row.x)).toBeLessThan(6);
    expect(csv.width).toBeGreaterThan(width === 1440 ? 500 : 280);
    await noSideways(page);
    await shot(page, 'o5-payouts-' + width);
  }
});

test('O6 the guardhouse field starts empty', async ({ page }) => {
  await page.addInitScript(quietWallet);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/guard/');
    const field = page.getByTestId('guard-account');
    await expect(field).toHaveValue('');
    const example = page.getByTestId('guard-example');
    await expect(example).toHaveText('Example: shop-moved-pay-here.near');
    await example.click();
    await expect(field).toHaveValue('shop-moved-pay-here.near');
    await field.fill('');
    await expect(field).toHaveValue('');
    await noSideways(page);
    await shot(page, 'o6-guard-' + width);
  }
});

test('O7 the wallet banner is only on pages that sign', async ({ page }) => {
  await page.addInitScript(savedScholar, 'visitor.near');
  const quiet = ['/shops/guard/', '/shops/bank/', '/shops/ferry/', '/shops/arena/', '/shops/toll/', '/shops/chronicle/', '/shops/payouts/'];
  const signing = ['/shops/hall/', '/shops/house/'];
  for (const width of [1440, 390]) {
    await at(page, width);
    for (const path of quiet) {
      await page.goto(path);
      await expect(page.getByTestId('restore-session')).toHaveCount(0);
      await expect(page.getByText('not connected in this tab')).toHaveCount(0);
      await radiosBeside(page);
      await noSideways(page);
      await shot(page, 'o7-' + path.split('/').filter(Boolean).pop() + '-' + width);
    }
    for (const path of signing) {
      await page.goto(path);
      await expect(page.getByTestId('restore-session')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('restore-note')).toContainText('not connected in this tab');
      await noSideways(page);
      await shot(page, 'o7-' + path.split('/').filter(Boolean).pop() + '-' + width);
    }
  }
  await page.goto('/shops/bank/');
  await expect(page.getByTestId('bank-session')).toContainText('Signed in as Scholar');
  await expect(page.getByTestId('restore-session')).toHaveCount(0);
});

test('O8 every shop form stays in the column', async ({ page }) => {
  await page.addInitScript(quietWallet);
  const shops = ['bank', 'hall', 'arena', 'ferry', 'payouts', 'guard', 'toll', 'chronicle', 'house', 'vault'];
  for (const width of [1440, 390]) {
    await at(page, width);
    for (const shop of shops) {
      await page.goto('/shops/' + shop + '/');
      await page.locator('h1').first().waitFor({ timeout: 20_000 });
      await radiosBeside(page);
      const checks = page.locator('label:has(input[type=checkbox])');
      const n = await checks.count();
      for (let i = 0; i < n; i++) {
        const box = checks.nth(i);
        const input = box.locator('input');
        const text = box.locator('span').first();
        if (await text.count() === 0) continue;
        const a = await input.boundingBox();
        const b = await text.boundingBox();
        if (!a || !b) continue;
        expect(a.x).toBeLessThan(b.x);
        expect(Math.abs((a.y + a.height / 2) - (b.y + b.height / 2))).toBeLessThan(18);
      }
      await noSideways(page);
      await shot(page, 'o8-' + shop + '-' + width);
    }
  }
});
