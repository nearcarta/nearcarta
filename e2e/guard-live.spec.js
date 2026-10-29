// Guardhouse payee check + poisoned invoice and the Mist Bank TEE panel, live on NEAR testnet with a fresh guest
// wallet (faucet account, key in this test browser only). The visitor builds a charter in the Charter office, then
// in the shops the agent checks the payee before signing; the visitor lets it knock anyway and the charter refuses.
// Opt-in (spends testnet faucet NEAR): GUARD_E2E=1. Writes judges/proofs/guard-live.json and e2e/shots/guard-*.png.
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

test.describe.configure({ mode: 'serial', retries: 0 });
test.setTimeout(900_000);
// WebGL shops in headless Chromium: software GL is slow (room assets take ~30 s), so skip camera tweens (&rm) and wait for boot.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });
const openShop = async (page, id) => { await page.goto(`/design/D8_shops/?shop=${id}&rm`); await page.waitForFunction(() => window.__ready && !window.__state().busy, null, { timeout: 180_000 }); };
test.skip(!process.env.GUARD_E2E, 'set GUARD_E2E=1 (uses the public testnet faucet)');
const shots = new URL('./shots/', import.meta.url).pathname; mkdirSync(shots, { recursive: true });
const proof = { at: null, base: null, wallet: 'NEAR Connect, injected guest wallet (fresh faucet account)', account: null, charter: null, steps: [] };
const save = () => { proof.at = new Date().toISOString(); writeFileSync(new URL('../judges/proofs/guard-live.json', import.meta.url), JSON.stringify(proof, null, 1) + '\n'); };
const txOf = async page => { const a = page.locator('#t-rcpt a[href*="/txns/"]').first(); return (await a.count()) ? (await a.getAttribute('href')).split('/txns/')[1] : null; };

test('payee check stops a poisoned invoice, the charter refuses it, and the Mist Bank shows a verified TEE', async ({ page, baseURL }) => {
  proof.base = baseURL;
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Charter office: fresh guest account, charter from the factory, rules + a propose-only agent key in this browser.
  await page.goto('/shops/vault/');
  await expect(page.locator('#factory code').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  await page.getByTestId('guest').click();
  await expect(page.getByTestId('who')).toHaveText(/ncguest-[a-z0-9]+\.testnet/, { timeout: 180_000 });
  proof.account = (await page.getByTestId('who').textContent()).trim();
  const name = 'gd-' + Date.now().toString(36);
  await page.locator('#cname').fill(name);
  await page.getByTestId('create').click();
  await expect(page.getByTestId('charter-id')).toHaveText(new RegExp('^' + name + '\\.'), { timeout: 120_000 });
  proof.charter = (await page.getByTestId('charter-id').textContent()).trim();
  await page.getByTestId('rules').click();
  await expect(page.locator('#mine')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('agent-key')).toContainText('Agent key in this browser', { timeout: 60_000 });
  save();

  // 2. Guardhouse, same browser and wallet.
  await openShop(page, 'guard');
  const act = page.locator('#t-act');
  await expect(act).toBeVisible({ timeout: 90_000 });
  await expect(act).not.toHaveText(/Lighting|Connect wallet/, { timeout: 30_000 }).catch(async () => {
    await act.click();
    const item = page.locator('.connect-item').filter({ hasText: 'Guest testnet account' });
    await item.waitFor({ timeout: 60_000 }); await item.click();
  });
  await expect(act).toHaveText('Try to trick my agent', { timeout: 90_000 });
  await expect(page.getByTestId('hidden-line')).toContainText('attacker.r10own-19371.testnet');
  await page.screenshot({ path: shots + 'guard-1-poisoned-invoice.png' });

  await act.click();
  await expect(page.getByTestId('check-verdict')).toContainText('BLOCK', { timeout: 60_000 });
  await expect(page.locator('#t-say')).toContainText('Stopped before signing');
  proof.steps.push({ step: 'poisoned-invoice: payee check', verdict: 'block', reasons: await page.getByTestId('check-reasons').locator('li').allInnerTexts() }); save();
  await page.screenshot({ path: shots + 'guard-2-check-blocked.png' });

  await expect(act).toHaveText('Let it knock anyway');
  await act.click();
  await expect(page.locator('#t-say')).toContainText('Second wall', { timeout: 180_000 });
  await expect(page.getByTestId('rule')).toContainText('refused');
  const t1 = await txOf(page);
  proof.steps.push({ step: 'poisoned-invoice: sent anyway', refused: (await page.getByTestId('rule').textContent()).trim(), tx: t1, url: t1 && `https://testnet.nearblocks.io/txns/${t1}` }); save();
  await page.screenshot({ path: shots + 'guard-3-charter-refused.png' });

  // 3. Lookalike payee: the check flags it; the charter refuses it too.
  await page.locator('input[name=atk][value=lookalike]').check({ force: true });
  await act.click();
  await expect(page.getByTestId('check-verdict')).toContainText(/BLOCK|WARN/, { timeout: 60_000 });
  const v2 = (await page.getByTestId('check-verdict').textContent()).trim();
  proof.steps.push({ step: 'lookalike: payee check', verdict: v2, reasons: await page.getByTestId('check-reasons').locator('li').allInnerTexts() }); save();
  await page.screenshot({ path: shots + 'guard-4-lookalike-check.png' });
  await act.click();
  await expect(page.getByTestId('rule')).toContainText('refused', { timeout: 180_000 });
  const t2 = await txOf(page);
  proof.steps.push({ step: 'lookalike: sent anyway', refused: (await page.getByTestId('rule').textContent()).trim(), tx: t2, url: t2 && `https://testnet.nearblocks.io/txns/${t2}` }); save();

  // 4. Mist Bank: verify the NEAR AI TEE now, then send privately (the send re-checks with the seal as nonce).
  await openShop(page, 'bank');
  await expect(page.getByTestId('tee-verify')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('tee-verify').click();
  await expect(page.getByTestId('tee-badge')).toContainText('✓ Verified', { timeout: 90_000 });
  proof.steps.push({ step: 'mist bank: TEE panel', badge: (await page.getByTestId('tee-badge').textContent()).trim(), rows: await page.getByTestId('tee-panel').locator('li').allInnerTexts() }); save();
  await page.screenshot({ path: shots + 'guard-5-tee-verified.png' });
  // Fixed note sizes now (no free amount): send the smallest note.
  await page.getByTestId('bank-notes').locator('input[name=note]').first().check({ force: true });
  await page.locator('#t-act').click();
  await expect(page.locator('#t-rcpt')).toContainText('TEE verified', { timeout: 180_000 });
  const t3 = await txOf(page);
  proof.steps.push({ step: 'mist bank: private send', rule: (await page.getByTestId('rule').textContent().catch(() => '')).trim(), tx: t3, url: t3 && `https://testnet.nearblocks.io/txns/${t3}` });
  await page.screenshot({ path: shots + 'guard-6-mist-sent.png' });
  proof.page_errors = errs; save();
});
