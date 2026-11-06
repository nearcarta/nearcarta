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

function savedScholar(accountId) {
  localStorage.setItem('nearcarta.setup.v1', JSON.stringify({
    accountId, displayName: 'Scholar', balanceNear: 1, walletId: 'nearcarta-privy',
  }));
  window.__NC_ACCOUNT = async () => null;
}

function faceOf(el) {
  const s = getComputedStyle(el);
  return {
    img: s.backgroundImage,
    color: s.color,
    border: s.borderTopWidth,
    family: s.fontFamily,
    size: s.fontSize,
    weight: s.fontWeight,
  };
}

test('R1 the charter office uses the shop title and the shop shell', async ({ page }) => {
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/ferry/');
    const ferry = await page.locator('header.shop-page').evaluate(el => {
      const h = el.querySelector('h1');
      const hs = getComputedStyle(h);
      return {
        width: Math.round(el.getBoundingClientRect().width),
        color: hs.color,
        family: hs.fontFamily,
        size: hs.fontSize,
        weight: hs.fontWeight,
      };
    });
    await page.goto('/shops/vault/');
    const h1 = page.locator('header.shop-page h1');
    await expect(h1).toHaveText('Charter office');
    await expect(page).toHaveTitle(/Charter office/);
    const vault = await page.locator('header.shop-page').evaluate(el => {
      const h = el.querySelector('h1');
      const hs = getComputedStyle(h);
      return {
        width: Math.round(el.getBoundingClientRect().width),
        color: hs.color,
        family: hs.fontFamily,
        size: hs.fontSize,
        weight: hs.fontWeight,
        shop: document.body.dataset.shop,
      };
    });
    expect(vault.shop).toBe('vault');
    expect(vault.color).toBe(ferry.color);
    expect(vault.color).not.toBe('rgb(255, 255, 255)');
    expect(vault.family).toBe(ferry.family);
    expect(vault.size).toBe(ferry.size);
    expect(vault.weight).toBe(ferry.weight);
    expect(Math.abs(vault.width - ferry.width)).toBeLessThanOrEqual(1);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(wide).toBe(true);
    await shot(page, 'r1-vault-' + width);
  }
});

test('R2 the chronicle action is one brass button', async ({ page }) => {
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/chronicle/');
    const btn = page.locator('#c-go');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('Show timeline');
    await btn.scrollIntoViewIfNeeded();
    const face = await btn.evaluate(faceOf);
    expect(face.img).toContain('245, 208, 138');
    expect(face.color).toBe('rgb(42, 22, 8)');
    expect(face.border).toBe('0px');
    await expect(page.locator('.chronicle-gold')).toHaveCount(1);
    await shot(page, 'r2-chronicle-' + width);
  }
});

test('R3 a signed-in account with no row gets a Rules and Sign call to action', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  await page.route('**/api/board/row/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ owner: OWNER, row: null }),
  }));
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/hall/');
    const hall = page.getByTestId('charter-cta');
    await expect(hall).toBeVisible({ timeout: 15_000 });
    await expect(hall).toContainText('Signed in as Scholar.');
    await expect(hall).toContainText('no charter row');
    await expect(page.getByTestId('hall-cap')).toHaveCount(0);
    const link = hall.getByTestId('charter-setup');
    await expect(link).toHaveAttribute('href', '/setup/#rules');
    const brass = await link.evaluate(faceOf);
    expect(brass.img).toContain('245, 208, 138');
    expect(brass.color).toBe('rgb(42, 22, 8)');
    await shot(page, 'r3-hall-' + width);
    await page.goto('/shops/house/');
    const house = page.getByTestId('charter-cta');
    await expect(house).toBeVisible({ timeout: 15_000 });
    await expect(house).toContainText('no charter row');
    await expect(page.getByTestId('house-cap')).toHaveCount(0);
    await expect(house.getByTestId('charter-setup')).toHaveAttribute('href', '/setup/#rules');
    await shot(page, 'r3-house-' + width);
    await house.getByTestId('charter-setup').click();
    await expect(page).toHaveURL(/\/setup\/#rules/);
    await expect(page.getByRole('heading', { name: 'Write the rules it cannot break.' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('rule-cap')).toBeVisible();
    await shot(page, 'r3-rules-' + width);
  }
});

test('R4 the hall row read shows a reason within 5 seconds', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  let gate = Promise.resolve();
  await page.route('**/api/board/row/**', async route => {
    await gate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ owner: OWNER, row: null }),
    });
  });
  for (const width of [1440, 390]) {
    let release;
    gate = new Promise(r => { release = r; });
    await at(page, width);
    await page.goto('/shops/hall/');
    await expect(page.getByTestId('hall-skel')).toBeVisible();
    await expect(page.getByTestId('hall-row-reason')).toContainText('did not answer in 5 seconds', { timeout: 8_000 });
    await expect(page.getByTestId('hall-skel')).toHaveCount(0);
    await expect(page.getByTestId('hall-retry')).toBeVisible();
    await shot(page, 'r4-hall-' + width);
    release();
    await expect(page.getByTestId('charter-cta')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('hall-cap')).toHaveCount(0);
    await expect(page.getByTestId('hall-row-reason')).toHaveCount(0);
  }
});

test('R5 the All shops list is clickable during the intro and the click skips it', async ({ page }) => {
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/?mode=2d');
    const intro = page.getByTestId('town-intro');
    await expect(intro).toBeVisible();
    const link = page.getByTestId('all-shops-link');
    await expect(link).toBeVisible();
    const hit = await link.evaluate(el => {
      document.body.classList.add('story');
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const s = getComputedStyle(el.closest('nav'));
      return { hit: el === top || el.contains(top), pe: s.pointerEvents, z: s.zIndex };
    });
    expect(hit.hit).toBe(true);
    expect(hit.pe).toBe('auto');
    expect(Number(hit.z)).toBeGreaterThanOrEqual(80);
    await link.click();
    await expect(page.getByTestId('town-intro')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/intro-on/);
    await expect(page.locator('body')).not.toHaveClass(/story/);
    const list = page.getByTestId('all-shops-list');
    await expect(list).toBeVisible();
    await shot(page, 'r5-shops-' + width);
    await list.getByRole('link', { name: 'Chronicle' }).click();
    await expect(page).toHaveURL(/\/shops\/chronicle\//);
    await expect(page.locator('h1')).toHaveText('Chronicle');
  }
});
