// Your House, end to end on NEAR testnet through NEAR Connect (@hot-labs/near-connect), the same wallet list visitors use.
// The throwaway testnet owner key goes into NEAR Connect's in-browser key slot ("Guest testnet account") of this test
// browser only; the owner signs freeze, unfreeze and an approve of a held agent spend there. Our backend never sees the key.
// Opt-in: needs HOUSE_OWNER_KEY_FILE (throwaway testnet owner key) and HOUSE_AGENT_KEY_FILE (propose-only agent key).
// Writes judges/proofs/house-wallet.json.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const OWNER = process.env.HOUSE_OWNER_KEY_FILE, AGENT = process.env.HOUSE_AGENT_KEY_FILE;
test.describe.configure({ mode: 'serial', retries: 0 });
test.setTimeout(480_000);
const save = () => { proof.at = new Date().toISOString(); writeFileSync(new URL('../judges/proofs/house-wallet.json', import.meta.url), JSON.stringify(proof, null, 1) + '\n'); };
const proof = { at: null, wallet: 'NEAR Connect (@hot-labs/near-connect 0.12.0), in-browser key slot "Guest testnet account"', site: null, house: null, owner: null, steps: [] };

test('owner freezes, unfreezes and approves a held spend through NEAR Connect', async ({ browser, baseURL }) => {
  test.skip(!OWNER || !AGENT, 'set HOUSE_OWNER_KEY_FILE and HOUSE_AGENT_KEY_FILE to run against testnet');
  const k = JSON.parse(readFileSync(OWNER, 'utf8'));
  proof.site = baseURL;
  const ctx = await browser.newContext();
  // 1. The owner key sits in this test browser's NEAR Connect key slot only.
  await ctx.addInitScript(g => { localStorage.setItem('nearcarta.vault.guest', g); }, JSON.stringify({ accountId: k.account_id, secret: k.private_key }));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/console#house');
  const api = await page.evaluate(() => (window.NEARCARTA_API || '').replace(/\/$/, '')); // '' on Vercel (same origin)
  const house = await (await page.request.get(api + '/api/house')).json();
  proof.house = house.oath; proof.owner = house.owner;
  expect(house.owner).toBe(k.account_id);
  expect(house.keys.fullAccess).toBe(0);
  await expect(page.getByTestId('house-frozen')).toHaveText('active', { timeout: 60_000 });

  // 2. Sign in from the NEAR Connect list (no access key is requested).
  await page.locator('#house button[data-act=signin]').click();
  const item = page.locator('.connect-item').filter({ hasText: 'Guest testnet account' });
  await item.waitFor({ timeout: 60_000 });
  const listed = await page.locator('.connect-item').allInnerTexts();
  await item.click();
  await expect(page.getByTestId('house-who')).toContainText(`${k.account_id} (owner)`, { timeout: 60_000 });
  proof.steps.push({ step: 'sign-in', wallet_list: listed.map(t => t.split('\n')[0]) });

  const signed = async act => {
    const before = await page.getByTestId('house-done').count();
    await page.locator(`#house button[data-act=${act}]`).first().click();
    await expect(page.getByTestId('house-done')).toHaveCount(before + 1, { timeout: 120_000 });
    const href = await page.locator(`[data-testid=house-done][data-act=${act}] [data-testid=house-tx]`).first().getAttribute('href');
    const hash = href.split('/txns/')[1];
    expect(hash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    proof.steps.push({ step: act, tx: hash, url: `https://testnet.nearblocks.io/txns/${hash}` }); save();
    return hash;
  };

  // 3. Freeze, then the chain says frozen; unfreeze (no DAO on this House, so the owner may).
  await signed('freeze');
  await expect(page.getByTestId('house-frozen')).toHaveText('frozen', { timeout: 60_000 });
  await signed('unfreeze');
  await expect(page.getByTestId('house-frozen')).toHaveText('active', { timeout: 60_000 });

  // 4. The agent asks for 0.02 NEAR (cap 0.01): the House holds it; the owner approves it.
  const child = spawn(process.execPath, ['backend/scripts/house-escalate.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, HOUSE_AGENT_KEY_FILE: AGENT } });
  let out = ''; child.stdout.on('data', d => (out += d)); child.stderr.on('data', d => (out += d));
  const done = new Promise(r => child.on('exit', r));
  await expect.poll(() => /ESCALATED (\d+)/.exec(out)?.[1], { timeout: 90_000, intervals: [1000] }).toBeTruthy();
  const id = /ESCALATED (\d+)/.exec(out)[1];
  await page.reload();
  await expect(page.getByTestId('house-who')).toContainText('(owner)', { timeout: 60_000 });
  await expect(page.locator(`tr[data-action="${id}"]`)).toBeVisible({ timeout: 60_000 });
  proof.steps.push({ step: 'agent-over-cap', action_id: id });
  await signed('approve');
  expect(await done).toBe(0);
  const res = JSON.parse(out.split('RESULT ')[1]);
  expect(res.final_status).toBe('confirmed');
  proof.steps.push({ step: 'held-spend-paid', action_id: id, propose_tx: res.propose.hash, url: res.propose.url, final_status: res.final_status, events: res.events.map(e => e.event) });
  proof.page_errors = errs.length;
  save();
  expect(errs).toEqual([]);
  await ctx.close();
});
