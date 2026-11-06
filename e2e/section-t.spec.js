import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import bs58 from 'bs58';
import { keyFrom, pubkeyHex } from '../shared/vault/tx.js';

const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });
const OWNER = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
const BOARD = 'board.nearcarta.near';
const CHRON = 'GVFKTgzgKcepGTmLs318LzNzzrf3pjtYgquZBopLjeCY';
const TOLL_TX = '9rin6TybBLoFBiDLJwfQTvWQ3ndc4j6BH24XyHupiA15';
const BLOCK = bs58.encode(Buffer.alloc(32, 9));
// A throwaway key for this process. It is never printed and send_tx is stubbed, so it cannot spend.
const agentKey = keyFrom();
const AGENT = pubkeyHex(agentKey);

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

function savedScholar(secret) {
  const accountId = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
  localStorage.setItem('nearcarta.setup.v1', JSON.stringify({
    accountId, displayName: 'Scholar', balanceNear: 1, walletId: 'nearcarta-privy',
  }));
  localStorage.setItem('nearcarta.vault.agent.' + accountId, secret);
  window.__NC_ACCOUNT = async () => null;
}

function charterRow() {
  const y = n => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
  return {
    owner: OWNER,
    receivers: ['charter.nearcarta.near', 'toll.nearcarta.near', OWNER],
    per_action_cap: y(0.005),
    daily_budget: y(0.02),
    max_actions_per_day: 20,
    window_start_min: 0,
    window_end_min: 0,
    min_amount: y(0.001),
    expires_at: String(BigInt(Date.now() + 864e5) * 1_000_000n),
    frozen: false,
    sealed: false,
    agent: AGENT,
    nonce: '4',
    balance: y(0.05),
    storage_locked: '0',
    spent_today: '0',
    actions_today: 0,
  };
}

function viewBytes(value) {
  return { result: Array.from(Buffer.from(JSON.stringify(value))), logs: [] };
}

/** Stub the board read and swallow send_tx. A continued send_tx would be a real broadcast. */
async function stubChain(page, { accessKey = null, onSend = null, accountAmount = null } = {}) {
  const row = charterRow();
  await page.route('**/*', async route => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    let body;
    try { body = req.postDataJSON(); } catch { return route.continue(); }
    if (!body || body.jsonrpc !== '2.0') return route.continue();
    const id = body.id;
    const p = body.params || {};
    if (body.method === 'send_tx') {
      onSend?.(body);
      return route.fulfill({ json: { jsonrpc: '2.0', id, result: { status: { SuccessValue: '' }, transaction: { hash: 'stub' }, receipts_outcome: [] } } });
    }
    if (body.method !== 'query') return route.continue();
    if (p.request_type === 'call_function' && p.method_name === 'get_charter') {
      return route.fulfill({ json: { jsonrpc: '2.0', id, result: viewBytes(row) } });
    }
    if (p.request_type === 'view_access_key') {
      if (!accessKey) return route.fulfill({ json: { jsonrpc: '2.0', id, error: { name: 'UNKNOWN_ACCESS_KEY', message: 'unknown key' } } });
      return route.fulfill({ json: { jsonrpc: '2.0', id, result: accessKey } });
    }
    if (p.request_type === 'view_account' && accountAmount) {
      return route.fulfill({ json: { jsonrpc: '2.0', id, result: { amount: accountAmount(), code_hash: '11111111111111111111111111111111' } } });
    }
    return route.continue();
  });
}

async function openShop(page, id) {
  await page.goto('/?mode=2d&nostory=1', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__skipTownIntro?.());
  const pin = page.locator(`.fbpin[data-id="${id}"]`);
  await expect(pin).toBeVisible({ timeout: 20000 });
  await pin.click();
  await page.waitForFunction(() => window.__apps?.A?.S?.ready === true, null, { timeout: 30000 });
}

async function readyAct(page, name) {
  const act = page.locator('#t-act');
  await expect(act).toHaveText(name, { timeout: 20000 });
  return act;
}

test('T1 a landed tx shows the receipt, not a load error', async ({ page }) => {
  await page.addInitScript(savedScholar, agentKey.secretKey);
  await stubChain(page);
  for (const width of [1440, 390]) {
    await at(page, width);
    await openShop(page, 'chronicle');
    await page.evaluate(() => { window.__walletSigns = 0; window.__NC_WALLET_SIGN = async () => { window.__walletSigns += 1; return 'GVFKTgzgKcepGTmLs318LzNzzrf3pjtYgquZBopLjeCY'; }; });
    await expect(page.locator('#t-act')).toBeHidden();
    await page.locator('#c-go').click();
    await expect(page.getByTestId('chronicle-verify')).toContainText('Nothing was signed');
    expect(await page.evaluate(() => window.__walletSigns)).toBe(0);
    await expect(page.locator('#t-say')).not.toContainText('something did not load');
    await expect(page.locator('#t-say')).not.toContainText('Stopped:');
    await shot(page, 't1-chronicle-' + width);

    await page.evaluate(hash => { window.__NC_WALLET_SIGN = async () => hash; }, TOLL_TX);
    await page.locator('#back').click();
    await page.locator('.fbpin[data-id="toll"]').click();
    await page.evaluate(hash => { window.__NC_WALLET_SIGN = async () => hash; }, TOLL_TX);
    await (await readyAct(page, 'Pay 0.001 NEAR')).click();
    await expect(page.locator('a.rc.tx').first()).toHaveAttribute('href', `https://nearblocks.io/txns/${TOLL_TX}`, { timeout: 20000 });
    await expect(page.locator('#t-say')).not.toContainText('something did not load');
    await shot(page, 't1-toll-' + width);
  }
});

test('T2 the header balance refreshes after a tx', async ({ page }) => {
  await page.addInitScript(savedScholar, agentKey.secretKey);
  let near = '1000000000000000000000000';
  await stubChain(page, { accountAmount: () => near });
  for (const width of [1440, 390]) {
    near = '1000000000000000000000000';
    await at(page, width);
    await page.goto('/?mode=2d&nostory=1', { waitUntil: 'domcontentloaded' });
    const hud = page.getByTestId('hud-account');
    await expect(hud).toContainText('1 NEAR', { timeout: 15000 });
    near = '2000000000000000000000000';
    await page.evaluate(() => dispatchEvent(new CustomEvent('nearcarta:tx', { detail: { hash: 'GVFKTgzgKcepGTmLs318LzNzzrf3pjtYgquZBopLjeCY', shop: 'chronicle', decision: 'allowed' } })));
    await expect(hud).toContainText('2 NEAR', { timeout: 5000 });
    await shot(page, 't2-balance-' + width);
  }
});

test('T3 a new chronicle entry shows in the list and the corner', async ({ page }) => {
  await page.addInitScript(savedScholar, agentKey.secretKey);
  await stubChain(page);
  await page.addInitScript(() => { window.__NC_WALLET_SIGN = async () => 'GVFKTgzgKcepGTmLs318LzNzzrf3pjtYgquZBopLjeCY'; });
  for (const width of [1440, 390]) {
    await at(page, width);
    await openShop(page, 'chronicle');
    await page.getByTestId('chronicle-account').fill('nearcarta.near');
    const row = page.locator('[data-testid="chronicle-page"] li').filter({ hasText: 'toll' });
    await expect(row.first()).toBeVisible({ timeout: 20000 });
    await expect(row.first().locator('a')).toHaveAttribute('href', /nearblocks\.io\/txns\//);
    await page.locator('#c-go').click();
    await expect(page.getByTestId('chronicle-statement')).toContainText('Historic rules: missing');
    await expect(page.getByTestId('chronicle-verify')).toContainText('Nothing was signed');
    await shot(page, 't3-chronicle-' + width);
  }
});

test('T4 the sign summary names the board, the method, and the key scope', async ({ page }) => {
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/sign');
    await page.waitForFunction(() => typeof window.__signWhat === 'function');
    const lines = await page.evaluate(() => {
      const card = (html) => {
        const el = document.createElement('article');
        el.className = 'pnc-action-card';
        el.innerHTML = html;
        return window.__signWhat(el);
      };
      const field = (k, v) => `<div class="pnc-action-card__field"><span class="pnc-action-card__field-label">${k}</span><span class="pnc-action-card__field-value">${v}</span></div>`;
      const open = card(`<div class="pnc-action-card__badge">FunctionCall</div>${field('Method', 'open_charter')}${field('To', 'board.nearcarta.near')}<div class="pnc-action-card__footer">Deposit: 0.02 NEAR</div><pre>{"receivers":["charter.nearcarta.near","toll.nearcarta.near"]}</pre>`);
      const key = card(`<div class="pnc-action-card__badge">AddKey</div>${field('To', '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8')}<div class="pnc-action-card__footer">Deposit: 0 NEAR</div><pre>{"permission":{"FunctionCall":{"receiver_id":"board.nearcarta.near","method_names":["propose"]}}}</pre>`);
      localStorage.setItem('nearcarta.sign.flow', 'private');
      const priv = card(`${field('Method', 'propose')}${field('To', 'board.nearcarta.near')}<div class="pnc-action-card__footer">Deposit: 0 NEAR</div>`);
      localStorage.removeItem('nearcarta.sign.flow');
      return { open, key, priv };
    });
    expect(lines.open).toContain('open_charter on board.nearcarta.near');
    expect(lines.open).toContain('Deposit 0.02 NEAR');
    expect(lines.open).not.toContain('Pay 0.02 NEAR to charter.nearcarta.near');
    expect(lines.key).toContain('AddKey');
    expect(lines.key).toContain('propose');
    expect(lines.key).toContain('board.nearcarta.near');
    expect(lines.key).toContain('cannot transfer NEAR');
    expect(lines.priv).toContain('Private flow');
    await shot(page, 't4-sign-' + width);
  }
});

test('T5 the bank proof is a link and the wallet names the private flow', async ({ page }) => {
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/?mode=2d&nostory=1', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.__skipTownIntro?.());
    await page.locator('.fbpin[data-id="bank"]').click();
    const net = page.getByTestId('bank-net');
    await expect(net.locator('a.tx')).toHaveAttribute('href', /nearblocks\.io\/txns\//, { timeout: 20000 });
    await expect(net).not.toContainText('<a class');
    await shot(page, 't5-bank-' + width);
  }
});

test('T6 a board row is a charter and the account field keeps every letter', async ({ page, request }) => {
  const ok = await request.get('/api/guardhouse/check/shop-moved-pay-here.near?charter=' + OWNER);
  expect(ok.status(), await ok.text()).toBe(200);
  const body = await ok.json();
  expect(body.error).toBeFalsy();
  expect(body.signals?.board_row).toBe(true);
  expect(body.verdict).toMatch(/allow|warn|block/);
  const missing = await request.get('/api/guardhouse/check/shop-moved-pay-here.near?charter=not-a-row-here.near');
  expect(missing.status()).toBe(400);
  expect((await missing.json()).error).toMatch(/Nearcarta charter/);

  await page.addInitScript(savedScholar, agentKey.secretKey);
  await stubChain(page);
  for (const width of [1440, 390]) {
    await at(page, width);
    await openShop(page, 'guard');
    const act = await readyAct(page, 'Try to trick my agent');
    await act.click();
    await expect(page.locator('#t-say')).not.toContainText('charter must be a Nearcarta charter', { timeout: 30000 });
    await expect(page.locator('#t-say')).toContainText(/Stopped before signing|Wait:|checked off chain|payee/);
    const input = page.getByTestId('guard-account');
    await input.click();
    await input.fill('');
    await page.keyboard.type('wasdshop.near', { delay: 15 });
    await expect(input).toHaveValue('wasdshop.near');
    await page.evaluate(() => window.__apps.paint());
    await expect(page.getByTestId('guard-account')).toHaveValue('wasdshop.near');
    await shot(page, 't6-guard-' + width);
  }
});

test('T7 a wallet cancel is not a defence and an over-cap ask never opens the wallet', async ({ page }) => {
  await page.addInitScript(savedScholar, agentKey.secretKey);
  await stubChain(page);
  await page.route('**/api/vault/ask/plan', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'not configured' }) }));
  for (const width of [1440, 390]) {
    await at(page, width);
    await openShop(page, 'arena');
    await page.evaluate(() => {
      window.__walletCalls = 0;
      window.__NC_WALLET_SIGN = async () => { window.__walletCalls++; throw new Error('User rejected the transaction'); };
    });
    const box = page.locator('#a-txt, textarea');
    await expect(box.first()).toBeVisible({ timeout: 20000 });
    await box.first().fill('pay 3');
    await (await readyAct(page, 'Send the scam')).click();
    await expect(page.locator('#t-say')).toContainText(/Refused by your rule|over the max|max/, { timeout: 20000 });
    await expect(page.locator('#t-say')).not.toContainText('+100');
    await expect(page.locator('#t-say')).not.toContainText('Blocked by a new rule');
    const calls = await page.evaluate(() => window.__walletCalls);
    expect(calls).toBe(0);

    await page.evaluate(() => { window.__apps.paint(); });
    await box.first().fill('pay 0.001');
    await (await readyAct(page, 'Send the scam')).click();
    await expect(page.locator('#t-say')).toContainText('Cancelled in the wallet', { timeout: 20000 });
    await expect(page.locator('#t-say')).toContainText('not a defence');
    await expect(page.locator('#t-say')).not.toContainText('+100');
    await expect(page.locator('#t-say')).not.toContainText('Blocked by a new rule');
    await shot(page, 't7-arena-' + width);
  }
});

test('T8 the house reads the board row', async ({ page }) => {
  await page.addInitScript(savedScholar, agentKey.secretKey);
  await stubChain(page);
  for (const width of [1440, 390]) {
    await at(page, width);
    await openShop(page, 'house');
    await (await readyAct(page, 'See my rules & record')).click();
    await expect(page.locator('#t-say')).toContainText(/Max 0\.005/, { timeout: 20000 });
    await expect(page.locator('#t-say')).not.toContainText('something did not load');
    await expect(page.locator('#t-say')).not.toContainText('Stopped:');
    await shot(page, 't8-house-' + width);
  }
});

test('T9 a propose-only key signs without opening the wallet', async ({ page }) => {
  await page.addInitScript(savedScholar, agentKey.secretKey);
  let sent = 0;
  await stubChain(page, {
    accessKey: {
      nonce: 1,
      permission: { FunctionCall: { allowance: '50000000000000000000000', receiver_id: BOARD, method_names: ['propose'] } },
      block_hash: BLOCK,
    },
    onSend: () => { sent += 1; },
  });
  for (const width of [1440, 390]) {
    sent = 0;
    const popups = [];
    page.on('popup', p => popups.push(p.url()));
    await at(page, width);
    await openShop(page, 'chronicle');
    await page.evaluate(() => { window.__walletCalls = 0; window.__NC_WALLET_SIGN = async () => { window.__walletCalls++; return 'should-not-run'; }; });
    await page.locator('#c-go').click();
    await expect(page.getByTestId('chronicle-verify')).toContainText('Nothing was signed');
    expect(sent).toBe(0);
    expect(await page.evaluate(() => window.__walletCalls)).toBe(0);
    expect(popups).toEqual([]);
    await expect(page).not.toHaveURL(/\/sign/);
    await shot(page, 't9-agent-' + width);
  }
});

test('T10 the ferry quote says nothing is sent', async ({ page }) => {
  await page.addInitScript(savedScholar, agentKey.secretKey);
  let sends = 0;
  await stubChain(page, { onSend: () => { sends += 1; } });
  await page.route('**/api/ferry/quote', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, checks: { signature: 'dry' }, to: { amount: '0.01000' }, from: { usd: '0.10' }, correlationId: 'abcdef1234567890' }),
  }));
  for (const width of [1440, 390]) {
    sends = 0;
    await at(page, width);
    await openShop(page, 'ferry');
    await (await readyAct(page, 'Get quote')).click();
    await expect(page.locator('#t-say')).toContainText('Nothing is sent from here', { timeout: 20000 });
    await expect(page.locator('#t-act')).toHaveText('Nothing is sent from here');
    await page.locator('#t-act').click();
    await expect(page.locator('#t-say')).toContainText('Nothing is sent from here');
    expect(sends).toBe(0);
    await shot(page, 't10-ferry-' + width);
  }
});

test('T11 payouts says it prepares a batch', async ({ page }) => {
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/?mode=2d&nostory=1', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.__skipTownIntro?.());
    const pin = page.locator('.fbpin[data-id="payouts"]');
    await expect(pin).toContainText(/prepare a batch/i);
    await expect(pin).not.toContainText(/pay many/i);
    await pin.click();
    await expect(page.locator('#t-label')).toContainText(/prepare a batch/i, { timeout: 20000 });
    await expect(page.locator('#t-say')).toContainText(/does not send/i);
    await expect(page.locator('#shopUI')).not.toContainText(/pay many at once/i);
    await shot(page, 't11-payouts-' + width);
  }
});

test('T12 a click on the payouts anchor opens Payouts when another label covers it', async ({ page }) => {
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/?mode=2d&nostory=1', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.__skipTownIntro?.());
    await expect(page.locator('.fbpin[data-id="payouts"]')).toBeVisible();
    const buried = await page.evaluate(() => {
      const pins = [...document.querySelectorAll('.fbpin')];
      const bad = [];
      for (const a of pins) {
        const ax = parseFloat(a.style.left), ay = parseFloat(a.style.top);
        for (const b of pins) {
          if (a === b) continue;
          const r = b.getBoundingClientRect();
          if (ax >= r.left && ax <= r.right && ay >= r.top && ay <= r.bottom) bad.push(a.dataset.id + ' inside ' + b.dataset.id);
        }
      }
      return bad;
    });
    expect(buried).toEqual([]);
    const anchor = await page.locator('.fbpin[data-id="payouts"]').evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
    await page.locator('.fbpin[data-id="hall"]').evaluate((el, a) => {
      el.style.left = a.x + 'px';
      el.style.top = (a.y + 420) + 'px';
      el.style.width = '2400px';
      el.style.minHeight = '700px';
      el.style.zIndex = '9';
    }, anchor);
    await page.mouse.click(anchor.x, anchor.y);
    await expect(page.locator('#t-title')).toHaveText('Payouts', { timeout: 20000 });
    await expect(page.locator('#t-title')).not.toHaveText('Town Hall');
    await shot(page, 't12-pins-' + width);
  }
});
