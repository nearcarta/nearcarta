// Charter office + Vault Arena, end to end on NEAR testnet with a brand-new faucet account.
// The page connects through NEAR Connect (guest wallet: a fresh faucet account whose key is made
// and kept in the test browser only), creates a charter from the factory, saves rules, issues an
// agent key, and runs scams that the contract must refuse. Opt-in (spends testnet faucet NEAR):
// VAULT_E2E=1. Writes judges/proofs/vault-e2e.json and e2e/shots/vault-*.png.
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

test.describe.configure({ mode: 'serial', retries: 0 });
test.setTimeout(420_000);
test.skip(!process.env.VAULT_E2E, 'set VAULT_E2E=1 (uses the public testnet faucet)');
const shots = new URL('./shots/', import.meta.url).pathname; mkdirSync(shots, { recursive: true });
const proof = { at: null, base: null, wallet: 'NEAR Connect 0.12.0, injected guest wallet (fresh faucet account)', account: null, charter: null, txs: [] };
const save = () => { proof.at = new Date().toISOString(); writeFileSync(new URL('../judges/proofs/vault-e2e.json', import.meta.url), JSON.stringify(proof, null, 1) + '\n'); };
const hashes = async loc => (await loc.locator('a[data-testid=tx]').evaluateAll(as => as.map(a => a.href.split('/').pop())));

test('visitor makes a charter and the contract refuses scams on chain', async ({ page, baseURL }) => {
  proof.base = baseURL;
  page.on('console', m => { if (m.type() === 'error') console.log('page error:', m.text().slice(0, 200)); });
  await page.goto('/shops/vault/');
  await expect(page.locator('#factory code').first()).toBeVisible();
  await page.screenshot({ path: shots + 'vault-1-start.png', fullPage: true });

  await page.getByTestId('guest').click();
  await expect(page.getByTestId('who')).toHaveText(/^ncguest-[a-z0-9]+\.testnet$/, { timeout: 90_000 });
  proof.account = await page.getByTestId('who').textContent();

  const name = 'e2e-' + Date.now().toString(36);
  await page.locator('#cname').fill(name);
  await page.getByTestId('create').click();
  await expect(page.getByTestId('charter-id')).toHaveText(new RegExp('^' + name + '\\.'), { timeout: 120_000 });
  proof.charter = await page.getByTestId('charter-id').textContent();
  proof.txs.push({ step: 'create_charter', tx: (await hashes(page.locator('#log')))[0] });
  await expect(page.locator('[data-testid=facts] li.ok', { hasText: 'audited oath code' })).toBeVisible();
  await expect(page.locator('[data-testid=facts] li.ok', { hasText: '0 full-access keys' })).toBeVisible();

  await page.getByTestId('rules').click();
  await expect(page.locator('#mine')).toBeVisible({ timeout: 120_000 });
  proof.txs.push({ step: 'set_clause + set_agent_key', tx: (await hashes(page.locator('#log')))[0] });
  await page.screenshot({ path: shots + 'vault-2-charter.png', fullPage: true });

  for (const [atk, reason] of [['lookalike', 'receiver_not_allowlisted'], ['impersonation', 'over_per_action_cap'], ['split-under-cap', 'over_daily_budget']]) {
    await page.getByTestId('atk-mine-' + atk).click();
    const v = page.locator('#mine [data-testid=verdict]');
    await expect(v).toContainText('refused it: ' + reason, { timeout: 180_000 });
    const steps = await hashes(page.locator('#mine .steps'));
    proof.txs.push({ step: 'attack ' + atk, refused: reason, txs: steps }); save();
    await page.locator('#mine').screenshot({ path: shots + `vault-3-${atk}.png` });
  }
  await expect(page.locator('[data-testid=board]')).toContainText(proof.account, { timeout: 60_000 });
  await page.locator('#s-board').screenshot({ path: shots + 'vault-4-board.png' });
  save();
});

test('shared arena: attack without a wallet', async ({ page }) => {
  const cfg = await (await page.request.get('/api/vault/config')).json();
  test.skip(!cfg.attack_enabled, 'shared runner has no agent key on this deployment');
  await page.goto('/shops/vault/');
  await page.locator('#nick').fill('e2e');
  await page.getByTestId('atk-shared-fake-invoice').click();
  await expect(page.locator('#shared [data-testid=verdict]')).toContainText('refused it: receiver_not_allowlisted', { timeout: 120_000 });
  proof.txs.push({ step: 'shared fake-invoice', txs: await hashes(page.locator('#shared .steps')) }); save();
  await page.locator('#shared').screenshot({ path: shots + 'vault-5-shared.png' });
});
