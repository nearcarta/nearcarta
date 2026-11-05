import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });
const OWNER = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
const SHOPS = ['bank', 'hall', 'arena', 'ferry', 'payouts', 'guard', 'toll', 'chronicle', 'house', 'vault'];

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

function savedScholar(accountId) {
  localStorage.setItem('nearcarta.setup.v1', JSON.stringify({
    accountId, displayName: 'Scholar', balanceNear: 1, walletId: 'nearcarta-privy',
  }));
  window.__NC_ACCOUNT = async () => null;
}

async function noDefaultButtons(page) {
  const bad = await page.locator('button').evaluateAll(els => els.filter(el => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || s.visibility === 'hidden' || s.display === 'none') return false;
    const font = parseFloat(s.fontSize);
    const img = s.backgroundImage;
    const bg = s.backgroundColor;
    const outset = s.borderTopStyle === 'outset';
    const grey = img === 'none' && /rgb\((239,\s*239,\s*239|107,\s*107,\s*107|221,\s*221,\s*221)\)/.test(bg);
    const ua = font < 14 && parseFloat(s.paddingTop) <= 2 && img === 'none';
    return outset || grey || ua;
  }).map(el => (el.textContent || '').trim().slice(0, 48)));
  expect(bad).toEqual([]);
}

test('P1 the payout list replaces the opening line within 3s', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const path of ['/shops/payouts', '/shops/payouts/']) {
    await page.goto(path);
    const row = page.getByTestId('payout-to');
    await expect(row).toBeVisible({ timeout: 3000 });
    await expect(row).toHaveValue(OWNER);
    await expect(page.getByTestId('payout-add')).toBeVisible();
    await expect(page.getByText(/Opening/)).toHaveCount(0);
  }
  await shot(page, 'p1-payouts-1440');
});

test('P2 the vault keeps the shop type, cards and a gap under sign in', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/vault');
    await expect(page).toHaveURL(/\/shops\/vault\/$/);
    await expect(page.locator('h1')).toBeVisible();
    const face = await page.locator('h1').evaluate(el => getComputedStyle(el).fontFamily);
    expect(face.toLowerCase()).not.toContain('times');
    const tab = await page.locator('#tab-mine').evaluate(el => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, border: s.borderTopStyle, font: parseFloat(s.fontSize) };
    });
    expect(tab.bg).not.toBe('rgb(107, 107, 107)');
    expect(tab.border).not.toBe('outset');
    expect(tab.font).toBeGreaterThanOrEqual(14);
    const overlap = await page.evaluate(() => {
      const s = document.querySelector('#connect').getBoundingClientRect();
      const t = document.querySelector('#tab-mine').getBoundingClientRect();
      if (s.width < 2 || t.width < 2) return false;
      return !(s.bottom <= t.top + 1 || s.top >= t.bottom - 1 || s.right <= t.left || s.left >= t.right);
    });
    expect(overlap).toBe(false);
    const inset = await page.evaluate(() => {
      const card = [...document.querySelectorAll('.card')].find(el => el.getBoundingClientRect().width > 20);
      return card ? card.getBoundingClientRect().left : 0;
    });
    expect(inset).toBeGreaterThanOrEqual(12);
    await noDefaultButtons(page);
    await shot(page, 'p2-vault-' + width);
  }
});

test('P3 the payee is its own group and the check button is full size', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/bank/');
    await expect(page.getByTestId('bank-amount')).toContainText('Amount');
    await expect(page.getByTestId('bank-payee')).toContainText('Payee');
    const id = page.locator('[data-testid=bank-to] .payee-id');
    await expect(id).toHaveText('8e2027…61c8');
    await expect(id).toHaveAttribute('title', OWNER);
    const amount = await page.getByTestId('bank-amount').boundingBox();
    const payee = await page.getByTestId('bank-payee').boundingBox();
    expect(payee.y).toBeGreaterThanOrEqual(amount.y + amount.height - 1);
    const btn = page.getByTestId('tee-verify');
    const box = await btn.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.y).toBeGreaterThanOrEqual(payee.y + payee.height + 8);
    const note = await page.getByTestId('tee-recorded').evaluate(el => {
      const s = getComputedStyle(el);
      return { color: s.color, size: parseFloat(s.fontSize) };
    });
    expect(note.color).toBe('rgb(255, 248, 238)');
    expect(note.size).toBeGreaterThanOrEqual(16);
    await shot(page, 'p3-bank-' + width);
  }
});

test('P4 the hall copy control sits beside the short id', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/hall/?owner=' + OWNER);
    const id = page.getByTestId('hall-row-id');
    const copy = page.getByTestId('hall-copy');
    await expect(id).toHaveText('8e2027…61c8', { timeout: 30_000 });
    await expect(copy).toBeVisible();
    const a = await id.boundingBox();
    const b = await copy.boundingBox();
    expect(b.width).toBeGreaterThan(40);
    expect(b.height).toBeGreaterThanOrEqual(36);
    const sameRow = Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) < 20;
    expect(sameRow ? b.x : b.y).toBeGreaterThan(sameRow ? a.x : a.y);
    const meta = await page.locator('.hall-meta').boundingBox();
    const cap = await page.getByTestId('hall-cap').boundingBox();
    expect(cap.y - (meta.y + meta.height)).toBeLessThan(48);
    await shot(page, 'p4-hall-' + width);
  }
  await page.getByTestId('hall-copy').click();
  await expect(page.getByTestId('hall-copy')).toHaveText('Copied');
});

test('P5 arena actions use the standard button size', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/arena/');
    for (const id of ['redteam-run', 'redteam-next']) {
      const box = await page.getByTestId(id).boundingBox();
      const font = await page.getByTestId(id).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      expect(box.height).toBeGreaterThanOrEqual(40);
      expect(font).toBeGreaterThanOrEqual(16);
    }
    await shot(page, 'p5-arena-' + width);
  }
});

test('P6 the mint record has space under the line above it', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/house/');
    const mint = page.getByTestId('deed-mint');
    await expect(mint).toBeVisible();
    const gap = await page.evaluate(() => {
      const a = document.querySelector('[data-testid=deed-mint]');
      const prev = a.parentElement.previousElementSibling;
      return a.getBoundingClientRect().top - prev.getBoundingClientRect().bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(24);
    await shot(page, 'p6-house-' + width);
  }
});

test('every shop leaves the opening line and the default button', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    await at(page, width);
    for (const shop of SHOPS) {
      await page.goto('/shops/' + shop + '/');
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Opening/)).toHaveCount(0, { timeout: 5000 });
      await noDefaultButtons(page);
      await shot(page, 'p-shop-' + shop + '-' + width);
    }
  }
});
