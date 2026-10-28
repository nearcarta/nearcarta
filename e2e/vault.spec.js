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
  await expect(page.locator('[data-testid=facts] li.ok', { hasText: 'audited oath code' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-testid=facts] li.ok', { hasText: '0 full-access keys' })).toBeVisible();
  await expect(page.getByTestId('timelock')).toContainText('1 day');
  await expect(page.getByTestId('setup')).toContainText('Setup window open');

  await page.locator('#rmax').fill('8'); // room for the ask, two jobs and the split attack before the budget bites
  await page.getByTestId('rules').click();
  await expect(page.locator('#mine')).toBeVisible({ timeout: 120_000 });
  proof.txs.push({ step: 'set_clause + set_agent_key', tx: (await hashes(page.locator('#log')))[0] });
  await page.screenshot({ path: shots + 'vault-2-charter.png', fullPage: true });
  await expect(page.getByTestId('setup')).toContainText('Setup closed', { timeout: 60_000 });
  await expect(page.getByTestId('agent-key')).toContainText('Agent key in this browser');
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('nearcarta.vault.agent.pending.')).length)).toBe(0);

  // The main card: ask the agent in plain words; the charter allows a useful payment.
  await expect(page.getByTestId('gauge-spent')).toBeVisible();
  await page.getByTestId('ask-text').fill('pay the cafe 0.01 NEAR for team coffee');
  await page.getByTestId('ask').click();
  await expect(page.locator('#mine [data-testid=verdict]')).toContainText('ALLOWED', { timeout: 180_000 });
  proof.txs.push({ step: 'ask: pay the cafe 0.01 NEAR for team coffee', allowed: true, txs: await hashes(page.locator('#mine .steps')) }); save();
  await expect(page.getByTestId('story')).toContainText('1 allowed');
  await page.screenshot({ path: shots + 'vault-2b-ask.png', fullPage: true });

  // Honest jobs first: real allowlisted payments the charter must ALLOW.
  for (const t of ['coffee-run', 'book-order']) {
    await page.getByTestId('task-mine-' + t).click();
    await expect(page.locator('#mine [data-testid=verdict]')).toContainText('allowed the honest payment', { timeout: 180_000 });
    proof.txs.push({ step: 'task ' + t, allowed: true, txs: await hashes(page.locator('#mine .steps')) }); save();
  }

  await page.getByTestId('go-arena').click();
  await expect(page.getByTestId('target-mine')).toBeChecked();
  for (const [atk, reason] of [['lookalike', 'receiver_not_allowlisted'], ['impersonation', 'over_per_action_cap'], ['split-under-cap', 'over_daily_budget']]) {
    await page.getByTestId('atk-mine-' + atk).click();
    const v = page.locator('#arena [data-testid=verdict]');
    await expect(v).toContainText('refused it', { timeout: 180_000 });
    await expect(v).toContainText(reason);
    const steps = await hashes(page.locator('#arena .steps'));
    proof.txs.push({ step: 'attack ' + atk, refused: reason, txs: steps }); save();
    await page.locator('#arena').screenshot({ path: shots + `vault-3-${atk}.png` });
  }
  await expect(page.getByTestId('score-mine')).toHaveText('6/9', { timeout: 60_000 });
  proof.score = await page.getByTestId('score-mine').textContent();
  await expect(page.getByTestId('story')).toContainText('refused');
  await page.getByTestId('tab-board').click();
  await expect(page.locator('[data-testid=board]')).toContainText(proof.account, { timeout: 60_000 });
  await page.locator('#s-board').screenshot({ path: shots + 'vault-4-board.png' });

  // Freeze: one owner approval, after which even an allowed payment is refused on chain.
  await page.getByTestId('tab-mine').click();
  await page.getByTestId('freeze').click();
  await expect(page.getByTestId('frozen')).toContainText('FROZEN', { timeout: 120_000 });
  proof.txs.push({ step: 'freeze', tx: (await hashes(page.locator('#log')))[0] });
  await page.getByTestId('ask-text').fill('pay the cafe 0.01 NEAR for coffee');
  await page.getByTestId('ask').click();
  await expect(page.locator('#mine [data-testid=verdict]')).toContainText('REFUSED: the charter is frozen', { timeout: 180_000 });
  proof.txs.push({ step: 'ask while frozen', refused: 'frozen', txs: await hashes(page.locator('#mine .steps')) });
  await page.screenshot({ path: shots + 'vault-6-frozen.png', fullPage: true });
  save();
});

test('shared arena: attack without a wallet', async ({ page }) => {
  // Ask the API the page itself uses (config.js may point at another host than BASE_URL).
  await page.goto('/shops/vault/');
  const cfg = await page.evaluate(async () => (await fetch((window.NEARCARTA_API || '') + '/api/vault/config')).json());
  test.skip(!cfg.attack_enabled, 'shared runner has no agent key on this deployment');
  await page.getByTestId('tab-arena').click();
  await expect(page.getByTestId('target-shared')).toBeChecked();
  await expect(page.locator('#nick')).toHaveValue(/^[a-z]+-[a-z]+-\d+$/);
  await page.locator('#nick').fill('e2e');
  await page.getByTestId('atk-shared-fake-invoice').click();
  const v = page.locator('#arena [data-testid=verdict]');
  await expect(v).toContainText('refused it', { timeout: 120_000 });
  await expect(v).toContainText('receiver_not_allowlisted');
  proof.txs.push({ step: 'shared fake-invoice', txs: await hashes(page.locator('#arena .steps')) }); save();
  await page.locator('#arena').screenshot({ path: shots + 'vault-5-shared.png' });
});
