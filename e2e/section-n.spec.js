import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
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

test('N1 a warn names the checks that caused it', async ({ page }) => {
  await page.addInitScript(quietWallet);
  await at(page, 1440);
  await page.goto('/shops/guard/');
  await page.getByTestId('guard-account').fill('nearcarta.near');
  await page.getByTestId('guard-check').click();
  const verdict = page.getByTestId('guard-verdict');
  await expect(verdict).toContainText('Warn because: no contract (code hash empty); first-seen unknown', { timeout: 60_000 });
  await shot(page, 'n1-guard-1440');
  await at(page, 390);
  await expect(verdict).toContainText('first-seen unknown');
  await noSideways(page);
  await shot(page, 'n1-guard-390');
});

test('N2 the hall reads the row again after the transaction is final', async ({ page, request }) => {
  const live = await (await request.get('/api/board/row/' + OWNER)).json();
  expect(live.row?.per_action_cap).toBeTruthy();
  const oldCap = live.row.per_action_cap;
  const nextNear = oldCap === '3000000000000000000000' ? '0.004' : '0.003';
  const nextYocto = nextNear === '0.003' ? '3000000000000000000000' : '4000000000000000000000';
  let statusHits = 0;
  let freshHits = 0;
  let freshBeforeFinal = false;
  await page.addInitScript(savedScholar, OWNER);
  await page.route('**/shops/hall/hall.bundle.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export async function signCalls(){ return { hash: '4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia', signer: ${JSON.stringify(OWNER)} }; }`,
  }));
  await page.route('**/api/tx-status/**', route => {
    statusHits += 1;
    const ready = statusHits >= 2;
    return route.fulfill({ json: { pass: ready, final: ready, why: ready ? 'success' : 'not final' } });
  });
  await page.route('**/api/board/row/**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('fresh') !== '1') return route.continue();
    freshHits += 1;
    if (statusHits < 2) freshBeforeFinal = true;
    if (freshHits === 1) return route.fulfill({ json: { ...live, fresh: true } });
    return route.fulfill({ json: { owner: OWNER, board: live.board, row: { ...live.row, per_action_cap: nextYocto }, fresh: true } });
  });
  await at(page, 1440);
  await page.goto('/shops/hall/?owner=' + OWNER);
  await expect(page.getByTestId('hall-cap')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('hall-cap').fill(nextNear);
  await page.getByTestId('hall-apply').click();
  await expect(page.getByTestId('hall-readback')).toContainText('Read back. Cap is ' + nextNear + ' NEAR.', { timeout: 20_000 });
  await expect(page.getByTestId('hall-readback')).not.toContainText('previous cap');
  expect(freshBeforeFinal).toBe(false);
  expect(freshHits).toBeGreaterThan(1);
  expect(statusHits).toBeGreaterThan(1);
  await shot(page, 'n2-hall-readback-1440');
  await at(page, 390);
  await expect(page.getByTestId('hall-readback')).toContainText(nextNear);
  await noSideways(page);
  await shot(page, 'n2-hall-readback-390');
});

test('N3 the hall shows one signed-in line after a skeleton', async ({ page }) => {
  let release;
  const gate = new Promise(r => { release = r; });
  await page.addInitScript(savedScholar, OWNER);
  await page.route('**/api/board/row/**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('fresh') === '1') return route.continue();
    await gate;
    return route.continue();
  });
  await at(page, 1440);
  await page.goto('/shops/hall/?owner=' + OWNER);
  await expect(page.getByTestId('hall-skel')).toBeVisible();
  await shot(page, 'n3-hall-skel-1440');
  await at(page, 390);
  await shot(page, 'n3-hall-skel-390');
  release();
  await expect(page.getByTestId('hall-facts')).toContainText('Signed in as Scholar', { timeout: 30_000 });
  const form = await page.getByTestId('hall-form').innerText();
  expect((form.match(/Signed in/g) || []).length).toBe(1);
  await expect(page.getByTestId('hall-read')).toBeVisible();
  await noSideways(page);
  await shot(page, 'n3-hall-row-390');
  await at(page, 1440);
  await shot(page, 'n3-hall-row-1440');
});

test('N4 a reload restores the wallet or offers one click', async ({ page, browser }) => {
  await page.addInitScript(() => { window.__NC_ACCOUNT = async () => 'visitor.near'; });
  await at(page, 1440);
  await page.goto('/shops/hall/');
  await expect(page.getByTestId('hall-facts')).toContainText('visitor.near', { timeout: 20_000 });
  const stored = await page.evaluate(() => localStorage.getItem('nearcarta.setup.v1'));
  expect(stored).toContain('visitor.near');
  await expect(page.getByTestId('restore-session')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('hall-facts')).toContainText('visitor.near');
  await shot(page, 'n4-restored-1440');
  await at(page, 390);
  await noSideways(page);
  await shot(page, 'n4-restored-390');

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.addInitScript(() => {
    localStorage.setItem('nearcarta.setup.v1', JSON.stringify({
      accountId: 'visitor.near', displayName: 'Scholar', balanceNear: 1, walletId: 'nearcarta-privy',
    }));
    window.__NC_ACCOUNT = async () => null;
    window.__NC_CONNECT = async () => 'visitor.near';
  });
  await at(other, 1440);
  await other.goto(base + '/shops/hall/');
  await expect(other.getByTestId('hall-facts')).toContainText('Signed in as Scholar', { timeout: 20_000 });
  await expect(other.getByTestId('restore-session')).toBeVisible();
  await shot(other, 'n4-restore-1440');
  await other.reload();
  await expect(other.getByTestId('restore-session')).toBeVisible();
  await at(other, 390);
  await expect(other.getByTestId('restore-note')).toContainText('not connected');
  await noSideways(other);
  await shot(other, 'n4-restore-390');
  await other.getByTestId('restore-session').click();
  await expect(other.getByTestId('restore-note')).toContainText('Wallet restored.');
  await expect(other.getByTestId('hall-facts')).toContainText('Signed in as Scholar');
  await expect(other.getByTestId('restore-session')).toBeHidden();
  await ctx.close();
});

test('N5 a payee radio sits beside its account', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  await at(page, 1440);
  await page.goto('/shops/bank/');
  const radio = page.locator('[data-testid=bank-to] input');
  const id = page.locator('[data-testid=bank-to] .payee-id');
  await expect(id).toHaveText('8e2027…61c8');
  await expect(id).toHaveAttribute('title', OWNER);
  const left = await radio.boundingBox();
  const label = await id.boundingBox();
  const card = await page.locator('.shop-card').boundingBox();
  const amount = await page.getByTestId('bank-amount').boundingBox();
  const payee = await page.getByTestId('bank-payee').boundingBox();
  expect(payee.y).toBeGreaterThanOrEqual(amount.y + amount.height - 1);
  expect(left.x).toBeLessThan(card.x + 80);
  expect(label.x).toBeLessThan(left.x + left.width + 20);
  await shot(page, 'n5-bank-payee-1440');
  await at(page, 390);
  await expect(id).toHaveText('8e2027…61c8');
  const wrapped = await id.boundingBox();
  expect(wrapped.height).toBeLessThan(36);
  await noSideways(page);
  const narrow = await radio.boundingBox();
  expect(narrow.x).toBeLessThan(80);
  await shot(page, 'n5-bank-payee-390');
});

test('N6 the bank and the arena use the brass cards and buttons', async ({ page }) => {
  await page.addInitScript(quietWallet);
  async function brass(locator) {
    const style = await locator.evaluate(el => {
      const s = getComputedStyle(el);
      return { image: s.backgroundImage, color: s.color };
    });
    expect(style.image).toContain('linear-gradient');
    expect(style.color).toBe('rgb(42, 22, 8)');
  }
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/bank/');
    await expect(page.locator('.shop-card')).toBeVisible();
    const edge = await page.locator('.shop-card').evaluate(el => getComputedStyle(el, '::before').backgroundImage);
    expect(edge).toContain('linear-gradient');
    await brass(page.getByTestId('tee-verify'));
    await shot(page, 'n6-bank-' + width);
    await page.goto('/shops/arena/');
    await expect(page.locator('.shop-card')).toBeVisible();
    await brass(page.getByTestId('redteam-run'));
    await brass(page.getByTestId('redteam-next'));
    await expect(page.getByTestId('redteam-run')).toContainText('spends if the charter allows');
    await shot(page, 'n6-arena-' + width);
  }
});

test('N7 a waiting button stays readable and says why', async ({ page }) => {
  let releaseFerry;
  const ferryGate = new Promise(r => { releaseFerry = r; });
  await page.route('**/api/ferry/quote**', async route => { await ferryGate; return route.continue(); });
  await page.addInitScript(quietWallet);
  await at(page, 1440);
  await page.goto('/shops/ferry/');
  const compare = page.getByTestId('ferry-compare');
  await expect(compare).toBeDisabled();
  await expect(page.getByTestId('control-reason')).toHaveText('Comparing routes. Waiting for the quotes.');
  const waiting = await compare.evaluate(el => {
    const s = getComputedStyle(el);
    return { opacity: s.opacity, color: s.color, background: s.backgroundColor };
  });
  expect(waiting.opacity).toBe('1');
  expect(waiting.color).toBe('rgb(42, 22, 8)');
  expect(waiting.background).toBe('rgb(230, 211, 168)');
  await shot(page, 'n7-ferry-1440');
  await at(page, 390);
  await noSideways(page);
  await shot(page, 'n7-ferry-390');
  releaseFerry();
  await expect(compare).toBeEnabled({ timeout: 60_000 });

  let releaseGuard;
  const guardGate = new Promise(r => { releaseGuard = r; });
  await page.route('**/api/guardhouse/check/**', async route => { await guardGate; return route.continue(); });
  await page.goto('/shops/guard/');
  await page.getByTestId('guard-check').click();
  const check = page.getByTestId('guard-check');
  await expect(check).toBeDisabled();
  await expect(page.getByTestId('control-reason')).toHaveText('Checking this account.');
  const guardStyle = await check.evaluate(el => getComputedStyle(el).opacity);
  expect(guardStyle).toBe('1');
  await shot(page, 'n7-guard-1440');
  await at(page, 390);
  await shot(page, 'n7-guard-390');
  releaseGuard();
  await expect(page.getByTestId('guard-verdict')).toBeVisible({ timeout: 60_000 });
});

test('N8 payouts start empty and grow by one row', async ({ page }) => {
  await page.addInitScript(quietWallet);
  await at(page, 1440);
  await page.goto('/shops/payouts/');
  await expect(page.getByTestId('payout-add')).toBeVisible();
  await expect(page.getByTestId('payout-to')).toHaveCount(0);
  await expect(page.getByTestId('payout-amt')).toHaveCount(0);
  await page.getByTestId('payout-add').click();
  await expect(page.getByTestId('payout-to')).toHaveValue('');
  await expect(page.getByTestId('payout-amt')).toHaveValue('');
  await shot(page, 'n8-payouts-1440');
  await page.getByTestId('payout-add').click();
  await page.getByTestId('payout-add').click();
  await expect(page.getByTestId('payout-to')).toHaveCount(3);
  await expect(page.getByTestId('payout-add')).toBeDisabled();
  await expect(page.getByTestId('payout-add-note')).toHaveText('Three rows is the daily count on this charter.');
  const color = await page.getByTestId('payout-add').evaluate(el => getComputedStyle(el).color);
  expect(color).toBe('rgb(42, 22, 8)');
  await page.getByTestId('payout-prepare').click();
  await expect(page.getByTestId('payout-receipt')).toHaveCount(0);
  await expect(page.getByTestId('payout-drop')).toHaveText('A row needs a payee. Nothing was prepared.');
  await at(page, 390);
  await noSideways(page);
  await shot(page, 'n8-payouts-390');
});
