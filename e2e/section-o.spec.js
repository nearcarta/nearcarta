import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });
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
  try { localStorage.removeItem('nearcarta.setup.v1'); } catch {}
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

async function radiosBeside(page) {
  const pairs = page.locator('label:has(input[type=radio])');
  const n = await pairs.count();
  for (let i = 0; i < n; i++) {
    const label = pairs.nth(i);
    const radio = label.locator('input[type=radio]');
    const text = label.locator('span').first();
    if (await text.count() === 0) continue;
    if (!(await radio.isVisible()) || !(await text.isVisible())) continue;
    const r = await radio.boundingBox();
    const s = await text.boundingBox();
    expect(r).toBeTruthy();
    expect(s).toBeTruthy();
    expect(r.x + r.width).toBeLessThanOrEqual(s.x + 2);
    expect(s.x - (r.x + r.width)).toBeLessThan(28);
    expect(Math.abs((r.y + r.height / 2) - (s.y + s.height / 2))).toBeLessThan(14);
  }
}

test('O1 every bank field label sits above its control', async ({ page }) => {
  await page.addInitScript(quietWallet);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/bank/');
    await expect(page.getByTestId('bank-sample-label')).toBeVisible();
    // The audit form pairs each <label for> with a select or input. A label
    // sharing a row with its control is the defect this guards: it reads as two
    // columns and squeezes both on a phone.
    const pairs = await page.evaluate(() => {
      const out = [];
      const root = document.querySelector('[data-testid=bank-pane-audit]');
      if (!root) return out;
      for (const label of root.querySelectorAll('label[for]')) {
        const ctl = root.querySelector('#' + CSS.escape(label.getAttribute('for')));
        if (!ctl) continue;
        const l = label.getBoundingClientRect();
        const c = ctl.getBoundingClientRect();
        if (!l.width || !c.width) continue;
        out.push({ lx: l.x, lb: l.bottom, cx: c.x, ct: c.top });
      }
      return out;
    });
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.ct).toBeGreaterThanOrEqual(p.lb - 1);
      expect(Math.abs(p.cx - p.lx)).toBeLessThan(2);
    }
    await noSideways(page);
    await shot(page, 'o1-bank-' + width);
  }
});

test('O2 the hall header shortens the account and the desk fills its column', async ({ page }) => {
  await page.addInitScript(savedScholar, OWNER);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/hall/');
    // The v2 desk shows the visitor in the page header, shortened, with the full id in the
    // title attribute. A 64-hex id printed in full is the defect: it overflows every phone.
    const who = page.getByTestId('who');
    await expect(who).toContainText('8e2027…61c8', { timeout: 60_000 });
    await expect(who).not.toContainText(OWNER);
    expect((await who.boundingBox()).height).toBeLessThan(60);

    // The desk is one column: it fills the room, and every field inside it stays inside it.
    const desk = await page.getByTestId('hall-desk').boundingBox();
    const room = await page.getByTestId('shop-room').boundingBox();
    expect(desk.width).toBeGreaterThan(room.width * 0.9);
    for (const id of ['hall-task', 'hall-budget', 'hall-cta']) {
      const b = await page.getByTestId(id).boundingBox();
      expect(b.x).toBeGreaterThanOrEqual(desk.x - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(desk.x + desk.width + 1);
    }
    await noSideways(page);
    await shot(page, 'o2-hall-' + width);
  }
});

test('O3 arena actions have a gap and the attack box is tall', async ({ page }) => {
  await page.addInitScript(quietWallet);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/arena/');
    await page.getByRole('tab', { name: 'Attack' }).click();
    const run = page.getByTestId('redteam-run');
    const next = page.getByTestId('redteam-next');
    await expect(run).toBeVisible();
    await expect(next).toBeVisible();
    const a = await run.boundingBox();
    const b = await next.boundingBox();
    const sameRow = b.y < a.y + a.height;
    const gap = sameRow ? b.x - (a.x + a.width) : b.y - (a.y + a.height);
    expect(gap).toBeGreaterThanOrEqual(10);
    const box = await page.locator('#a-txt').boundingBox();
    expect(box.height).toBeGreaterThan(100);
    await noSideways(page);
    await shot(page, 'o3-arena-' + width);
  }
});

test('O4 ferry route buttons are brass cards', async ({ page }) => {
  await page.addInitScript(quietWallet);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/ferry/');
    const chips = page.getByTestId('ferry-route');
    await expect(chips).toHaveCount(3);
    await expect(page.getByTestId('ferry-compare')).toBeEnabled({ timeout: 60_000 });
    // Which chip starts selected depends on the corridor the ferry picks, so read the state
    // from aria-pressed rather than assuming an index: the selected chip is gold, the idle
    // ones are dark brass. Both are gradients; only the selected one shines.
    const on = chips.and(page.locator('[aria-pressed=true]'));
    await expect(on).toHaveCount(1);
    const live = await on.evaluate(el => {
      const s = getComputedStyle(el);
      return { image: s.backgroundImage, color: s.color, anim: s.animationName };
    });
    expect(live.color).toBe('rgb(42, 22, 8)');
    expect(live.anim).toBe('routeShine');
    expect(live.image).toContain('linear-gradient');

    const idle = await chips.and(page.locator('[aria-pressed=false]')).first().evaluate(el => {
      const s = getComputedStyle(el);
      return { image: s.backgroundImage, color: s.color };
    });
    expect(idle.image).toContain('linear-gradient');
    expect(idle.color).toBe('rgb(255, 248, 238)');
    await noSideways(page);
    await shot(page, 'o4-ferry-' + width);
  }
});

test('O5 payouts rows and paste field share one column', async ({ page }) => {
  await page.addInitScript(quietWallet);
  for (const width of [1440, 390]) {
    await at(page, width);
    await page.goto('/shops/payouts/');
    // "Add a row" and the paste box live on the Payroll tab, so the test has to open it
    // rather than asserting on the default Invoice pane and timing out.
    await page.getByTestId('payouts-tab-payroll').click();
    const add = page.getByTestId('payout-add');
    await expect(add).toBeVisible({ timeout: 30_000 });
    // The list starts empty, so there is no row to measure until one is added.
    await add.click();
    await expect(page.locator('[data-testid=payout-list] li')).toHaveCount(1);
    const card = await page.getByTestId('payouts-card').boundingBox();
    const boxes = {
      add: await add.boundingBox(),
      csv: await page.getByTestId('payout-csv').boundingBox(),
      row: await page.locator('[data-testid=payout-list] li').first().boundingBox(),
    };
    // One column: every block starts at the card's own left edge and stays inside it. The
    // page title lives in the site header, so it is not part of this column.
    for (const [name, b] of Object.entries(boxes)) {
      expect(b, name).toBeTruthy();
      expect(Math.abs(b.x - card.x), name + ' left edge').toBeLessThan(6);
      expect(b.x + b.width, name + ' right edge').toBeLessThanOrEqual(card.x + card.width + 1);
    }
    expect(boxes.csv.width).toBeGreaterThan(width === 1440 ? 500 : 280);
    await noSideways(page);
    await shot(page, 'o5-payouts-' + width);
  }
});

test('O6 the guardhouse field starts empty and the example is derived from the visitor', async ({ page }) => {
  for (const width of [1440, 390]) {
    await at(page, width);

    // No session: the example cannot be derived, so the button says what to do instead of
    // inventing a payee, and the field stays empty.
    await page.addInitScript(quietWallet);
    await page.goto('/shops/guard/');
    const field = page.getByTestId('guard-account');
    await expect(field).toHaveValue('');
    await page.getByTestId('guard-example').click();
    await expect(field).toHaveValue('');
    await expect(page.getByTestId('guard-attested')).toContainText('Finish /setup');

    // With a session the example is a look-alike of the visitor's OWN account, never a fixed
    // address. This is the path that was dead: the standalone route never supplied the hook.
    await page.addInitScript(savedScholar, OWNER);
    await page.goto('/shops/guard/');
    await expect(field).toHaveValue('');
    const derived = await page.evaluate(async () => {
      const m = await import('/guard-lookalike.js');
      return m.lookalike('8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8');
    });
    await expect(page.getByTestId('guard-example')).toHaveText('Example: ' + derived);
    await page.getByTestId('guard-example').click();
    await expect(field).toHaveValue(derived);
    await field.fill('');
    await expect(field).toHaveValue('');

    await noSideways(page);
    await shot(page, 'o6-guard-' + width);
  }
});

test('O7 the wallet banner is only on pages that sign', async ({ page }) => {
  await page.addInitScript(savedScholar, 'visitor.near');
  const quiet = ['/shops/guard/', '/shops/bank/', '/shops/ferry/', '/shops/arena/', '/shops/toll/', '/shops/chronicle/', '/shops/payouts/'];
  const signing = ['/shops/hall/', '/shops/house/'];
  for (const width of [1440, 390]) {
    await at(page, width);
    for (const path of quiet) {
      await page.goto(path);
      await expect(page.getByTestId('restore-session')).toHaveCount(0);
      await expect(page.getByText('not connected in this tab')).toHaveCount(0);
      await radiosBeside(page);
      await noSideways(page);
      await shot(page, 'o7-' + path.split('/').filter(Boolean).pop() + '-' + width);
    }
    for (const path of signing) {
      await page.goto(path);
      await expect(page.getByTestId('restore-session')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('restore-note')).toContainText('not connected in this tab');
      await noSideways(page);
      await shot(page, 'o7-' + path.split('/').filter(Boolean).pop() + '-' + width);
    }
  }
  await page.goto('/shops/bank/');
  await expect(page.getByTestId('bank-session')).toContainText('Signed in as Scholar');
  await expect(page.getByTestId('restore-session')).toHaveCount(0);
});

test('O8 every shop form stays in the column', async ({ page }) => {
  await page.addInitScript(quietWallet);
  const shops = ['bank', 'hall', 'arena', 'ferry', 'payouts', 'guard', 'toll', 'chronicle', 'house', 'vault'];
  for (const width of [1440, 390]) {
    await at(page, width);
    for (const shop of shops) {
      await page.goto('/shops/' + shop + '/');
      await page.locator('h1').first().waitFor({ timeout: 20_000 });
      await radiosBeside(page);
      const checks = page.locator('label:has(input[type=checkbox])');
      const n = await checks.count();
      for (let i = 0; i < n; i++) {
        const box = checks.nth(i);
        const input = box.locator('input');
        const text = box.locator('span').first();
        if (await text.count() === 0) continue;
        const a = await input.boundingBox();
        const b = await text.boundingBox();
        if (!a || !b) continue;
        expect(a.x).toBeLessThan(b.x);
        expect(Math.abs((a.y + a.height / 2) - (b.y + b.height / 2))).toBeLessThan(18);
      }
      await noSideways(page);
      await shot(page, 'o8-' + shop + '-' + width);
    }
  }
});
