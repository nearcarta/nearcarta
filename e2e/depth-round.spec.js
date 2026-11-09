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
    // A shop can render perfectly while the network is on fire: Your House shipped four HTTP 400s
    // per visit (get_clauses/get_state with account_id null) and looked fine, because the failure
    // was only visible in devtools. Collect 4xx/5xx for the whole loop and assert at the end.
    //
    // 503 and 429 are EXCLUDED, narrowly and for stated reasons:
    //   503 — /api/ferry/quote answers it when the deployed API has no signing key. That is
    //         documented behaviour and reaches the panel as an honest refusal.
    //   429 — this loop opens eighteen rooms in quick succession, so the rate limiter kicks in.
    //         Measured: 25 x 429 across /api/toll and /api/deployments. The API is doing its job.
    // The bug this guards is a 4xx from a MALFORMED request (400/404/422), not a service that
    // throttles or says no.
    const netFailures = [];
    page.on('response', r => {
      const s = r.status();
      if (s >= 400 && s !== 503 && s !== 429) netFailures.push(`${s} ${new URL(r.url()).pathname}`);
    });
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
    // The evidence for the whole loop, asserted once so the message names the shop is not needed:
    // an empty list is the pass condition, and any entry prints its status and path.
    expect(netFailures, `shops must not fail requests: ${netFailures.join(', ')}`).toEqual([]);
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
  // A payee is required before the check runs: pressing Check payee on an empty field now asks
  // for the payee instead of fetching a verdict for an empty account. The old test clicked with
  // the field blank and only passed because the panel used to send the empty string.
  await page.locator('#g-acct').waitFor({ state: 'visible', timeout: 20_000 });
  // The panel mounts then re-paints once the session resolves. Clicking during that repaint left
  // the verdict empty even though the same flow passed alone; waiting for the mount to settle (the
  // pay button is rendered by the same pass) removes the race. Reproduced 3/3 with this wait.
  await page.locator('#g-pay').waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {});
  await page.locator('#g-acct').fill('shop-moved-pay-here.near');
  await expect(page.locator('#g-check')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('guard-check').click();
  await expect(page.getByTestId('guard-verdict')).toContainText('Block because: on the deny list', { timeout: 20_000 });
  await expect(page.getByTestId('guard-score')).toContainText('Lookalike');
  await expect(page.getByTestId('guard-score')).toContainText('Recorded refusals');
  await page.goto('/?mode=2d&nostory&shop=chronicle');
  await page.getByTestId('chronicle-account').fill('nearcarta.near');
  await page.locator('#c-go').click();
  await expect(page.getByTestId('chronicle-verify')).toContainText(/Showing \d+ of \d+\.|\d+ rows?\./, { timeout: 20_000 });
  // A page is one batch of six behind Show more, so the recorded rows are reached through it.
  for (let i = 0; i < 4; i++) {
    const more = page.locator('#c-more');
    if (!(await more.isVisible().catch(() => false))) break;
    await more.click();
    await page.waitForTimeout(150);
  }
  await page.getByTestId('chronicle-search').fill('toll');
  await expect(page.getByTestId('chronicle-page')).toContainText('toll', { timeout: 20_000 });
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
  await page.getByTestId('ferry-tab-routes').click();
  await expect(page.getByTestId('ferry-corridors')).toContainText('No quote yet');
  await page.getByTestId('ferry-compare-wrap').locator('summary').click();
  await page.getByTestId('ferry-compare').click();
  await expect(page.getByTestId('ferry-corridors')).toContainText(/USD not quoted|on zec/, { timeout: 30_000 });
  await page.getByTestId('ferry-compare-wrap').locator('summary').click();
  await expect(page.getByTestId('ferry-row').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Waiting for the deposit');
  await page.goto('/?mode=2d&nostory&shop=bank');
  // The TEE controls live on the Attestation tab; the panel opens on Audit, so the button is in the
  // DOM but not visible until that tab is selected. The old test clicked it from Audit and waited
  // 30s for a button it could not see.
  await page.getByTestId('bank-tab-attest').click();
  // The city bank panel renders the attestation controls (tee-verify / tee-result / tee-live) but
  // not the recorded-file link; that link belongs to the standalone shop shell. The substantive
  // claim is that the recorded proof file is served and the live check names its outcome, so
  // assert those two things rather than an id this view never renders.
  const proof = await page.request.get('/tee-public.json');
  expect(proof.status()).toBe(200);
  expect(Object.keys(await proof.json())).toContain('tcbStatus');
  await page.getByTestId('tee-verify').click();
  await expect(page.getByTestId('tee-result')).toHaveText(/attested|failed|partial/, { timeout: 60_000 });
  await page.goto('/?mode=2d&nostory&shop=payouts');
  // The CSV textarea and the per-row `payout-receipt` list belong to different panes, and the CSV
  // pane stays hidden until its tab is selected. Assert what the Payroll pane actually renders
  // signed out: adding a row gives a row to fill, and preparing with an empty payee refuses with a
  // reason rather than inventing a receipt. (section-m M3 covers this flow and passes.)
  await page.getByTestId('payouts-tab-payroll').click();
  await page.getByTestId('payout-add').click();
  // The pane already carries a row, so adding one gives at least two. What matters is that a row
  // exists to fill and that preparing with an empty payee refuses instead of inventing a receipt.
  await expect(page.getByTestId('payout-to').first()).toBeVisible();
  await page.getByTestId('payout-prepare').click();
  await expect(page.getByTestId('payout-receipt')).toHaveCount(0);
  await expect(page.getByTestId('payout-drop')).toContainText(/payee/i);
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
