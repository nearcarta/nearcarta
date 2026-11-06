import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });
const OWNER = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
const SHOPS = [
  ['/shops/bank/', 'Mist Bank'],
  ['/shops/hall/', 'Town Hall'],
  ['/?shop=ferry', 'Ferry'],
  ['/shops/guard/', 'Guardhouse'],
  ['/shops/arena/', 'Vault Arena'],
  ['/shops/toll/', 'Toll Bridge'],
  ['/shops/chronicle/', 'Chronicle'],
  ['/shops/house/', 'Your House'],
  ['/shops/payouts/', 'Payouts'],
  ['/shops/vault/', 'Charter office'],
];

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

test('Q1 the TEE check shows each step and the button stays put', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/bank/');
    const btn = page.getByTestId('tee-verify');
    await expect(btn).toBeVisible();
    await expect(page.getByTestId('tee-step')).toHaveCount(8);
    await btn.scrollIntoViewIfNeeded();
    const gap = () => page.getByTestId('tee-verify').evaluate(el => {
      const payee = document.querySelector('[data-testid=bank-payee]');
      return el.getBoundingClientRect().top - payee.getBoundingClientRect().bottom;
    });
    const before = await gap();
    await btn.click();
    await expect(page.locator('[data-step=request] .tee-why')).toContainText('Asking NEAR AI', { timeout: 1000 });
    expect(Math.abs((await gap()) - before)).toBeLessThan(4);
    await expect(page.getByTestId('tee-result')).toHaveText(/attested|failed/, { timeout: 20_000 });
    await expect(page.getByText('Checking the TEE…')).toHaveCount(0);
    expect(Math.abs((await gap()) - before)).toBeLessThan(4);
    const failed = (await page.getByTestId('tee-result').innerText()).trim() === 'failed';
    if (failed) await expect(page.getByTestId('tee-fail')).toContainText(/Nothing was signed|:/);
    await shot(page, 'q1-bank-' + width);
  }
});

test('Q2 the hall copy control clears the row line and the cap is 0.004', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/hall/?owner=' + OWNER);
    const id = page.getByTestId('hall-row-id');
    const full = page.getByTestId('hall-row-full');
    const copy = page.getByTestId('hall-copy');
    await expect(id).toHaveText('8e2027…61c8', { timeout: 30_000 });
    await expect(full).toHaveText(OWNER);
    await expect(page.getByTestId('hall-cap')).toHaveValue('0.004');
    const overlap = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.hall-meta dt')].find(el => el.textContent.trim() === 'Row');
      const button = document.querySelector('[data-testid=hall-copy]');
      if (!row || !button) return true;
      const a = row.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      return !(b.bottom <= a.top + 1 || b.top >= a.bottom - 1 || b.right <= a.left + 1 || b.left >= a.right - 1);
    });
    expect(overlap).toBe(false);
    const face = await full.evaluate(el => {
      const s = getComputedStyle(el);
      return { color: s.color, size: parseFloat(s.fontSize) };
    });
    expect(face.color).toBe('rgb(255, 248, 238)');
    expect(face.size).toBeGreaterThanOrEqual(16);
    const a = await id.boundingBox();
    const b = await copy.boundingBox();
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    await shot(page, 'q2-hall-' + width);
  }
});

test('Q3 the house deed links are brass and the charter row is shown', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/house/?owner=' + OWNER);
    await expect(page.getByTestId('house-cap')).toHaveText('0.004', { timeout: 30_000 });
    await expect(page.getByText('The house read did not return a row')).toHaveCount(0);
    await expect(page.getByTestId('house-state')).toContainText('Town Hall');
    const mint = page.getByTestId('deed-mint');
    const allow = page.getByTestId('deed-allow');
    const refuse = page.getByTestId('deed-refuse');
    const brass = await mint.evaluate(el => {
      const s = getComputedStyle(el);
      return { img: s.backgroundImage, deco: s.textDecorationLine, color: s.color };
    });
    expect(brass.img).toContain('linear-gradient');
    expect(brass.deco).not.toContain('underline');
    expect(brass.color).toBe('rgb(42, 22, 8)');
    const gap = await page.evaluate(() => {
      const a = document.querySelector('[data-testid=deed-allow]').getBoundingClientRect();
      const b = document.querySelector('[data-testid=deed-refuse]').getBoundingClientRect();
      const sameRow = Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) < 20;
      return sameRow ? b.x - (a.x + a.width) : b.y - (a.y + a.height);
    });
    expect(gap).toBeGreaterThanOrEqual(8);
    await expect(allow).toBeVisible();
    await expect(refuse).toBeVisible();
    await shot(page, 'q3-house-' + width);
  }
});

test('Q4 check signature is the brass button', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/toll/');
    const btn = page.getByTestId('check-signature');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('Check signature');
    const face = await btn.evaluate(el => {
      const s = getComputedStyle(el);
      return { img: s.backgroundImage, color: s.color, size: parseFloat(s.fontSize), h: el.getBoundingClientRect().height };
    });
    expect(face.img).toContain('linear-gradient');
    expect(face.color).toBe('rgb(42, 22, 8)');
    expect(face.size).toBeGreaterThanOrEqual(16);
    expect(face.h).toBeGreaterThanOrEqual(44);
    await shot(page, 'q4-toll-' + width);
  }
});

test('Q5 the locked rules card says why in readable type', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/vault/');
    const lock = page.getByTestId('rules-lock');
    await expect(lock).toBeVisible();
    await expect(lock).toContainText('no factory charter');
    await expect(lock).toContainText('Town Hall');
    const face = await lock.evaluate(el => {
      const s = getComputedStyle(el);
      return { color: s.color, size: parseFloat(s.fontSize), opacity: s.opacity };
    });
    expect(face.color).toBe('rgb(255, 248, 238)');
    expect(face.size).toBeGreaterThanOrEqual(16);
    expect(face.opacity).toBe('1');
    const card = await page.locator('#s-rules').evaluate(el => getComputedStyle(el).opacity);
    expect(card).toBe('1');
    await shot(page, 'q5-vault-' + width);
  }
});

test('Q6 the home page lists every shop without hiding the city', async ({ page }) => {
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/');
    const link = page.getByTestId('all-shops-link');
    await expect(link).toBeVisible();
    await expect(page.locator('#c')).toBeAttached();
    await link.click();
    const list = page.getByTestId('all-shops-list');
    await expect(list).toBeVisible();
    for (const [href, name] of SHOPS) {
      const a = list.locator(`a[href="${href}"]`);
      await expect(a).toBeVisible();
      await expect(a).toHaveText(name);
    }
    const canvas = await page.locator('#c').evaluate(el => getComputedStyle(el).display);
    expect(canvas).not.toBe('none');
    await shot(page, 'q6-shops-' + width);
  }
});
