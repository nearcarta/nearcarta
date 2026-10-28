// Your House, end to end on NEAR testnet with a real wallet: NEAR Wallet Selector -> MyNearWallet (testnet) popup.
// The owner signs freeze, unfreeze and an approve of a held agent spend in the wallet window; the page never sees a key.
// Opt-in: needs HOUSE_OWNER_KEY_FILE (throwaway testnet owner key, imported into the test browser's wallet only)
// and HOUSE_AGENT_KEY_FILE (propose-only agent key). Writes judges/proofs/house-wallet.json.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const OWNER = process.env.HOUSE_OWNER_KEY_FILE, AGENT = process.env.HOUSE_AGENT_KEY_FILE;
test.describe.configure({ mode: 'serial', retries: 0 });
test.setTimeout(480_000);
const WALLET = 'https://testnet.mynearwallet.com';
const BUTTONS = ['Continue', 'Next', 'Connect', 'Approve', 'Confirm', 'Allow'];
const save = () => { proof.at = new Date().toISOString(); writeFileSync(new URL('../judges/proofs/house-wallet.json', import.meta.url), JSON.stringify(proof, null, 1) + '\n'); };
const proof = { at: null, wallet: 'MyNearWallet (testnet) via @near-wallet-selector 10.1.4', house: null, owner: null, steps: [] };

async function drive(w, pw, log) {
  // Click through the wallet window until it closes itself (the wallet posts the result back to the opener).
  for (let i = 0; i < 90 && !w.isClosed(); i++) {
    await w.waitForTimeout(1500).catch(() => {}); if (w.isClosed()) break;
    const pass = w.locator('input[type=password]');
    if (await pass.first().isVisible().catch(() => false)) {
      for (let j = 0; j < await pass.count(); j++) await pass.nth(j).fill(pw).catch(() => {});
      await w.getByRole('button', { name: /Unlock/i }).click({ timeout: 3000 }).catch(() => {}); continue;
    }
    for (const name of BUTTONS) {
      const b = w.getByRole('button', { name, exact: true }).last();
      if (await b.isVisible().catch(() => false) && await b.isEnabled().catch(() => false)) { log.push(name); await b.click({ timeout: 3000 }).catch(() => {}); break; }
    }
  }
  return w.isClosed();
}

async function viaWallet(ctx, page, pw, click) {
  const log = [];
  const [w] = await Promise.all([ctx.waitForEvent('page', { timeout: 30_000 }), click()]);
  expect(new URL(w.url()).origin).toBe(WALLET);
  expect(await drive(w, pw, log)).toBe(true);
  return log;
}

test('owner freezes, unfreezes and approves a held spend from a real wallet', async ({ browser, baseURL }) => {
  test.skip(!OWNER || !AGENT, 'set HOUSE_OWNER_KEY_FILE and HOUSE_AGENT_KEY_FILE to run against the testnet wallet');
  const k = JSON.parse(readFileSync(OWNER, 'utf8'));
  const pw = 'test-only-' + Math.random().toString(36).slice(2) + 'A1!';
  const ctx = await browser.newContext();
  // 1. Put the throwaway testnet owner key in this test browser's wallet (MyNearWallet's own import route).
  const w = await ctx.newPage();
  await w.goto(`${WALLET}/auto-import-secret-key#${k.account_id}/${encodeURIComponent(k.private_key)}`);
  const pass = w.locator('input[type=password]'); await pass.first().waitFor({ timeout: 30_000 });
  for (let j = 0; j < await pass.count(); j++) await pass.nth(j).fill(pw);
  const cbs = w.locator('input[type=checkbox]'); for (let j = 0; j < await cbs.count(); j++) await cbs.nth(j).evaluate(e => e.click());
  await w.locator('#modal-root').getByRole('button', { name: 'Continue' }).click({ timeout: 8000 }).catch(() => {});
  await w.getByRole('button', { name: 'Next' }).click();
  await expect(w.locator('body')).toContainText('Success', { timeout: 60_000 });
  await w.close();

  // 2. The console: sign in through Wallet Selector (no access key is requested, so each call needs the wallet).
  const page = await ctx.newPage();
  await page.goto('/#house');
  const house = await (await page.request.get('/api/house')).json();
  proof.house = house.oath; proof.owner = house.owner;
  expect(house.keys.fullAccess).toBe(0);
  await expect(page.getByTestId('house-frozen')).toHaveText('active', { timeout: 30_000 });
  proof.steps.push({ step: 'sign-in', wallet_buttons: await viaWallet(ctx, page, pw, () => page.getByRole('button', { name: 'Sign in with MyNearWallet' }).click()) });
  await expect(page.getByTestId('house-who')).toContainText(`${k.account_id} (owner)`, { timeout: 20_000 });

  const signed = async act => {
    const before = await page.getByTestId('house-done').count();
    const buttons = await viaWallet(ctx, page, pw, () => page.locator(`button[data-act=${act}]`).first().click());
    await expect(page.getByTestId('house-done')).toHaveCount(before + 1, { timeout: 60_000 });
    const hash = await page.locator(`[data-testid=house-done][data-act=${act}] [data-testid=house-tx]`).first().innerText();
    expect(hash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    proof.steps.push({ step: act, tx: hash, url: `https://testnet.nearblocks.io/txns/${hash}`, wallet_buttons: buttons }); save();
    return hash;
  };

  // 3. Freeze from the wallet, then the chain says frozen; unfreeze (no DAO on this House, so the owner may).
  await signed('freeze');
  await expect(page.getByTestId('house-frozen')).toHaveText('FROZEN', { timeout: 30_000 });
  await signed('unfreeze');
  await expect(page.getByTestId('house-frozen')).toHaveText('active', { timeout: 30_000 });

  // 4. The agent asks for 0.02 NEAR (cap 0.01): the House holds it; the owner approves it from the wallet.
  const child = spawn(process.execPath, ['backend/scripts/house-escalate.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, HOUSE_AGENT_KEY_FILE: AGENT } });
  let out = ''; child.stdout.on('data', d => (out += d)); child.stderr.on('data', d => (out += d));
  const done = new Promise(r => child.on('exit', r));
  await expect.poll(() => /ESCALATED (\d+)/.exec(out)?.[1], { timeout: 90_000, intervals: [1000] }).toBeTruthy();
  const id = /ESCALATED (\d+)/.exec(out)[1];
  await page.reload();
  await expect(page.getByTestId('house-who')).toContainText('(owner)', { timeout: 30_000 });
  await expect(page.locator(`tr[data-action="${id}"]`)).toBeVisible({ timeout: 30_000 });
  proof.steps.push({ step: 'agent-over-cap', action_id: id });
  await signed('approve');
  expect(await done).toBe(0);
  const res = JSON.parse(out.split('RESULT ')[1]);
  expect(res.final_status).toBe('confirmed');
  proof.steps.push({ step: 'held-spend-paid', action_id: id, propose_tx: res.propose.hash, url: res.propose.url, final_status: res.final_status, events: res.events.map(e => e.event) });
  save();
  await ctx.close();
});
