import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

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

test('S1 All shops opens on the first click while the scene is loading', async ({ page }) => {
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/?mode=2d', { waitUntil: 'domcontentloaded' });
    const link = page.getByTestId('all-shops-link');
    await expect(link).toBeVisible();
    await page.evaluate(() => {
      document.body.classList.remove('ready');
      document.body.classList.add('story', 'intro-on');
      const loading = document.getElementById('loading');
      if (loading) loading.classList.remove('done');
      const details = document.querySelector('nav.all-shops details');
      if (details) details.open = false;
    });
    const during = await link.evaluate(el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + Math.min(24, r.width / 2), r.y + r.height / 2);
      const nav = getComputedStyle(el.closest('nav'));
      return { hit: !!(top && (top === el || el.contains(top))), pe: nav.pointerEvents, z: Number(nav.zIndex) };
    });
    expect(during.hit).toBe(true);
    expect(during.pe).toBe('auto');
    expect(during.z).toBeGreaterThanOrEqual(80);
    await link.click();
    const list = page.getByTestId('all-shops-list');
    await expect(list).toBeVisible();
    await expect(page.locator('nav.all-shops details')).toHaveJSProperty('open', true);
    await expect(page.getByTestId('town-intro')).toHaveCount(0);
    await shot(page, 's1-loading-' + width);
    await page.evaluate(() => {
      document.body.classList.remove('intro-on', 'story');
      const intro = document.getElementById('town-intro');
      if (intro) intro.remove();
      const details = document.querySelector('nav.all-shops details');
      if (details) details.open = false;
      const loading = document.getElementById('loading');
      if (loading) loading.classList.remove('done');
      document.body.classList.remove('ready');
    });
    await link.click();
    await expect(list).toBeVisible();
    await expect(page.locator('nav.all-shops details')).toHaveJSProperty('open', true);
    await list.getByRole('link', { name: 'Chronicle' }).click();
    await expect(page).toHaveURL(/\/shops\/chronicle\//);
  }
});

test('S2 the charter office uses the shared session', async ({ page, browser }) => {
  const bare = await browser.newPage();
  await bare.setViewportSize({ width: 1440, height: 900 });
  await bare.goto('/shops/vault/');
  await expect(bare.getByTestId('connect')).toHaveText('Sign in');
  await expect(bare.getByTestId('factory-signin')).toHaveCount(0);
  await bare.close();

  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/vault/');
    await expect(page.getByTestId('connect')).toBeHidden();
    await expect(page.getByTestId('who')).toContainText('Scholar');
    const note = page.getByTestId('factory-signin');
    await expect(note).toBeVisible();
    await expect(note).toContainText('factory wallet');
    await expect(note).toContainText(/nothing is signed/i);
    await expect(page.getByTestId('factory-connect')).toHaveText('Connect factory wallet');
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
    const face = await note.evaluate(el => {
      const s = getComputedStyle(el);
      return { color: s.color, size: parseFloat(s.fontSize) };
    });
    expect(face.color).toBe('rgb(255, 248, 238)');
    expect(face.size).toBeGreaterThanOrEqual(16);
    await expect(page.getByTestId('rules-lock')).toContainText('Town Hall');
    await shot(page, 's2-vault-' + width);
  }
});

test('S3 the house row read answers or shows a reason within 5 seconds', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    let release;
    const gate = new Promise(r => { release = r; });
    await page.route('**/api/board/row/**', async route => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ owner: OWNER, board: 'board.nearcarta.near', row: null }),
      });
    });
    await at(page, width);
    await page.goto('/shops/house/');
    await expect(page.getByTestId('house-reading')).toBeVisible();
    await expect(page.getByTestId('house-row-reason')).toContainText('did not answer in 5 seconds', { timeout: 8_000 });
    await expect(page.getByTestId('house-reading')).toHaveCount(0);
    await expect(page.getByText('Reading the charter row…')).toHaveCount(0);
    await expect(page.getByTestId('house-retry')).toBeVisible();
    const note = page.locator('#house .note');
    const face = await note.evaluate(el => {
      const s = getComputedStyle(el);
      return { color: s.color, size: parseFloat(s.fontSize) };
    });
    expect(face.color).toBe('rgb(255, 248, 238)');
    expect(face.size).toBeGreaterThanOrEqual(16);
    const deed = await page.getByTestId('deed-meta').evaluate(el => {
      const s = getComputedStyle(el);
      return { color: s.color, size: parseFloat(s.fontSize) };
    });
    expect(deed.color).toBe('rgb(255, 248, 238)');
    expect(deed.size).toBeGreaterThanOrEqual(16);
    await shot(page, 's3-house-' + width);
    release();
    await expect(page.getByTestId('charter-cta')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('house-row-reason')).toHaveCount(0);
    await page.unroute('**/api/board/row/**');
  }
});

test('S4 the setup step shell is painted before the config read', async ({ page }) => {
  let hold = true;
  await page.route('**/api/vault/config', async route => {
    while (hold) await new Promise(r => setTimeout(r, 40));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ network: 'mainnet', factory: 'factory.nearcarta.near', rpc: 'https://free.rpc.fastnear.com', rpc_fallbacks: [] }),
      });
    } catch { /* the page moved on */ }
  });
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/setup/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Start here.' })).toBeVisible();
    await expect(page.getByTestId('setup-steps')).toBeVisible();
    await expect(page.getByTestId('setup-step').filter({ hasText: 'Rules' })).toBeVisible();
    await expect(page.getByText('Preparing your setup…')).toHaveCount(0);
    if (width === 1440) await expect(page.locator('#rail')).toContainText('Sign in');
    else await expect(page.locator('#bar')).toBeVisible();
    await shot(page, 's4-setup-' + width);
  }
  hold = false;
});

test('S4 a saved session opens the Rules step without waiting on config', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route('**/api/vault/config', async route => {
    await gate;
    await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/setup/#rules', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Write the rules it cannot break.' })).toBeVisible();
  await expect(page.getByTestId('rule-cap')).toBeVisible();
  await expect(page.getByText('Preparing your setup…')).toHaveCount(0);
  await shot(page, 's4-rules-1440');
  release();
});

test('S5 the agent map names the shops, routes, contracts, and commands', async () => {
  const doc = readFileSync(new URL('../docs/AGENT_CONTEXT.md', import.meta.url), 'utf8');
  for (const name of ['Town', 'Setup', 'Charter office', 'Town Hall', 'Your House', 'Ferry', 'Mist Bank', 'Guardhouse', 'Vault Arena', 'Toll Bridge', 'Chronicle', 'Payouts']) {
    expect(doc).toContain(name);
  }
  for (const bit of [
    '/shops/vault/',
    '/setup/',
    'GET /api/health',
    'POST /api/ferry/quote',
    'GET /api/board/row/:owner',
    'shared/deployments/mainnet.json',
    'contracts/oath',
    'contracts/charter_board',
    'node backend/scripts/deploy-mainnet-board.js',
    'npm test',
    'npm run verify',
    'npm run e2e',
    'Lamplighter',
    'dry: true',
  ]) expect(doc).toContain(bit);
  expect(doc).not.toMatch(/ed25519:[1-9A-HJ-NP-Za-km-z]/);
});
