// Live check of the vault's "What happened" feed (the chain chronicle) with a brand-new charter at three widths.
// Each run: fresh faucet guest, create a charter, save rules, then time (a) the feed filling from chain after the
// rules tx and (b) the allowed ask's tx showing up in it. Both must be within 15 s. Opt-in (spends testnet faucet
// NEAR): VAULT_E2E=1. Writes judges/proofs/vault-feed-live.json and e2e/shots/vault-feed-<width>.png.
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

test.describe.configure({ mode: 'serial', retries: 0 });
test.setTimeout(420_000);
test.skip(!process.env.VAULT_E2E, 'set VAULT_E2E=1 (uses the public testnet faucet)');
const shots = new URL('./shots/', import.meta.url).pathname; mkdirSync(shots, { recursive: true });
const out = new URL('../judges/proofs/vault-feed-live.json', import.meta.url);
const runs = [];
const LIMIT = 15_000;

for (const [w, h] of [[1440, 900], [1280, 800], [390, 844]]) {
  test(`feed fills from chain within 15 s at ${w}`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors = [], chron = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('response', async r => { if (r.url().includes('/api/chronicle/')) chron.push({ status: r.status(), busy: !!(await r.json().catch(() => ({}))).busy, source: (await r.json().catch(() => ({}))).source || null }); });
    await page.goto('/setup/');
    await page.getByTestId('setup-guest').click();
    await expect(page.getByTestId('setup-who')).toHaveText(/^ncguest-[a-z0-9]+\.testnet$/, { timeout: 90_000 });
    await page.goto('/shops/vault/');
    await expect(page.getByTestId('who')).toHaveText(/^ncguest-[a-z0-9]+\.testnet$/, { timeout: 30_000 });
    const name = 'feed-' + Date.now().toString(36);
    await page.locator('#cname').fill(name);
    await page.getByTestId('create').click();
    await expect(page.getByTestId('charter-id')).toHaveText(new RegExp('^' + name + '\\.'), { timeout: 120_000 });
    const charter = await page.getByTestId('charter-id').textContent();
    await page.getByTestId('rules').click();
    await expect(page.locator('#mine')).toBeVisible({ timeout: 120_000 });
    const t0 = Date.now();
    await expect(page.locator('#feed [data-testid=feed-row]').first()).toBeVisible({ timeout: LIMIT });
    const fillMs = Date.now() - t0;
    const rowsAfterRules = await page.locator('#feed [data-testid=feed-row]').count();

    await page.getByTestId('ask-text').fill('pay the cafe 0.01 NEAR for team coffee');
    await page.getByTestId('ask').click();
    await expect(page.locator('#mine [data-testid=verdict]')).toContainText('ALLOWED', { timeout: 180_000 });
    const askTxs = await page.locator('#mine .steps a[data-testid=tx]').evaluateAll(as => as.map(a => a.href.split('/').pop()));
    const t1 = Date.now();
    await expect.poll(async () => (await page.locator('#feed a.tx').evaluateAll(as => as.map(a => a.title))).some(x => askTxs.includes(x)), { timeout: LIMIT, intervals: [250] }).toBe(true);
    const askMs = Date.now() - t1;
    await page.locator('#s-what').scrollIntoViewIfNeeded();
    await page.screenshot({ path: shots + `vault-feed-${w}.png`, fullPage: true });
    const feed = await page.locator('#feed [data-testid=feed-row]').allInnerTexts();
    runs.push({ width: w, base: baseURL, charter, feed_fill_ms_after_rules: fillMs, rows_after_rules: rowsAfterRules, ask_txs: askTxs, ask_in_feed_ms: askMs,
      feed: feed.map(s => s.replace(/\s+/g, ' ').trim()), chronicle_responses: chron, console_errors: errors });
    const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
    writeFileSync(out, JSON.stringify({ ...prev, at: new Date().toISOString(), limit_ms: LIMIT, runs }, null, 1) + '\n');
    expect(errors).toEqual([]);
  });
}
