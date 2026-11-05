import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const shots = process.env.SHOTS_DIR || '/opt/cursor/artifacts/screenshots';
mkdirSync(shots, { recursive: true });

const shops = [
  ['chronicle', 'Chronicle'],
  ['hall', 'Town Hall'],
  ['bank', 'Mist Bank'],
  ['ferry', 'Ferry'],
  ['guard', 'Guardhouse'],
  ['arena', 'Vault Arena'],
  ['house', 'Your House'],
  ['toll', 'Toll Bridge'],
  ['payouts', 'Payouts'],
];

async function axeContrast(page) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2aa']).disableRules(['region']).analyze();
  const contrast = axe.violations.filter(v => v.id === 'color-contrast');
  expect(contrast.map(v => v.nodes.map(n => n.html).slice(0, 2))).toEqual([]);
}

for (const width of [1440, 390]) {
  test(`every shop opens twice at ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [id, name] of shops) {
      for (let n = 0; n < 2; n++) {
        await page.goto(`/?mode=2d&nostory&shop=${id}`);
        await expect(page.locator('#t-title')).toHaveText(name, { timeout: 30_000 });
        await expect(page.locator('#t-label')).not.toHaveText('This room could not load');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      }
      await page.screenshot({ path: `${shots}/shop-${id}-${width}.png` });
      await axeContrast(page);
    }
  });
}

test('a failed room offers Try again and the next room does not keep that copy', async ({ page }) => {
  let hallHits = 0;
  await page.route('**/shops/hall.js*', async route => {
    hallHits += 1;
    if (hallHits === 1) {
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: 'throw new Error("HALL-ROOM-COPY");' });
      return;
    }
    await route.continue();
  });
  await page.goto('/?mode=2d&nostory&shop=hall');
  await expect(page.locator('#t-label')).toHaveText('This room could not load', { timeout: 20_000 });
  await expect(page.locator('#d-body')).toContainText('HALL-ROOM-COPY');
  await page.locator('#t-act').click();
  await expect(page.locator('#t-title')).toHaveText('Town Hall', { timeout: 20_000 });
  await expect(page.locator('body')).not.toContainText('HALL-ROOM-COPY');
  await page.getByTestId('back-town').click();
  await page.locator('#fbpins .fbpin[data-id=chronicle]').click();
  await expect(page.locator('#t-title')).toHaveText('Chronicle', { timeout: 20_000 });
  await expect(page.locator('body')).not.toContainText('HALL-ROOM-COPY');
});

test('guard, chronicle, toll, house, ferry and the bank proof are usable', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/api/guardhouse/check/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      account: 'shop-moved-pay-here.near', verdict: 'block', reasons: [{ code: 'denylisted', level: 'block', text: 'On the deny list' }],
      signals: { age_ms: 48 * 3600_000, code_hash: 'abc', lookalike_of: 'townhall.nearcarta.near', deny: { reason: 'Refused on mainnet', evidence: ['E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ'] } },
    }),
  }));
  await page.route('**/api/ai/tee**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, model: 'z-ai/glm-5.3-flash', nonce: 'abc', gateway: { checks: {}, tcbStatus: 'OutOfDate' }, models: [{ checks: {} }] }),
  }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mode=2d&nostory&shop=guard');
  await page.getByTestId('guard-check').click();
  await expect(page.getByTestId('guard-verdict')).toContainText('Block because: on the deny list', { timeout: 20_000 });
  await expect(page.getByTestId('guard-score')).toContainText('Lookalike');
  await expect(page.getByTestId('guard-score')).toContainText('Recorded refusals');
  await page.goto('/?mode=2d&nostory&shop=chronicle');
  await page.getByTestId('chronicle-search').fill('toll');
  await expect(page.getByTestId('chronicle-page')).toContainText('toll');
  await page.getByTestId('chronicle-filter').selectOption('denied');
  await page.getByRole('button', { name: 'Verify' }).first().click();
  await expect(page.getByTestId('chronicle-link')).toHaveAttribute('href', /nearblocks\.io/);
  await page.getByTestId('chronicle-export').click();
  await expect(page.getByTestId('chronicle-verify')).toContainText('toll');
  await page.goto('/?mode=2d&nostory&shop=toll');
  await expect(page.getByTestId('toll-derive')).toContainText('0x4c07c97812098f595ff1611d8cb3465e591ee38a');
  await expect(page.getByTestId('toll-derive')).toContainText('does not pay');
  await page.goto('/?mode=2d&nostory&shop=house');
  await expect(page.getByTestId('deed-moved')).toContainText('previous holder');
  await expect(page.getByTestId('deed-allow')).toHaveAttribute('href', /83nyJmTW/);
  await page.goto('/?mode=2d&nostory&shop=ferry');
  await page.getByTestId('ferry-compare').click();
  await expect(page.getByTestId('ferry-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ferry-idle')).toContainText('No deposit has been requested');
  await expect(page.locator('body')).not.toContainText('Waiting for the deposit');
  await page.goto('/?mode=2d&nostory&shop=bank');
  await expect(page.getByTestId('tee-proof')).toHaveAttribute('href', '/tee-public.json');
  await page.getByTestId('tee-verify').click();
  await expect(page.getByTestId('tee-result')).toHaveText(/attested|failed/, { timeout: 60_000 });
  await page.goto('/?mode=2d&nostory&shop=payouts');
  await page.getByTestId('payout-csv').fill('cafe.near,0.001,NEAR\npay.near,0.2,USDC');
  await page.getByTestId('payout-prepare').click();
  await expect(page.getByTestId('payout-receipt')).toHaveCount(2);
  await expect(page.getByTestId('payout-usdc')).toContainText('Not sent');
});

test('setup try step shows the daily quota at 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/setup/?preview=1#try');
  await expect(page.getByTestId('try-allowed')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('try-allowed')).toContainText(/left today/);
  await page.getByTestId('try-allowed').click();
  await expect(page.getByTestId('try-preview-note')).toContainText('not sent');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${shots}/setup-try-390.png`, fullPage: true });
  await page.goto('/setup/?preview=1#character');
  await expect(page.locator('.portrait')).toBeVisible();
  await page.screenshot({ path: `${shots}/setup-character-390.png`, fullPage: true });
});

test('the camera story moves when 3D starts', async ({ page }) => {
  test.setTimeout(40_000);
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.intro === 'camera' || document.body.dataset.intro === 'flat' || document.body.classList.contains('fb'), null, { timeout: 25_000 });
  const intro = await page.evaluate(() => document.body.dataset.intro || (document.body.classList.contains('fb') ? 'flat' : ''));
  if (intro === 'camera') {
    await expect(page.locator('#town-intro')).toHaveCount(0);
    await expect(page.getByTestId('speech-line').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => (window.__introMotion || []).length >= 2, null, { timeout: 10_000 });
    await page.screenshot({ path: `${shots}/intro-camera.png` });
  } else {
    await expect(page.getByTestId('town-intro')).toBeVisible();
    await page.screenshot({ path: `${shots}/intro-flat.png` });
  }
});
