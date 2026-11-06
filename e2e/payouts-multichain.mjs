// City check for the Payouts multichain pass, at desktop and phone widths.
// Reads the live page, drives the tray, and writes screenshots plus a JSON report.
// It signs nothing: a foreign row stops at the receipt, and the agent command is a dry parse.
// node e2e/payouts-multichain.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const OUT = process.env.OUT_DIR || '/tmp/payouts-multichain';
const CITY = `${BASE}/?mode=2d&nostory&shop=payouts`;
mkdirSync(OUT, { recursive: true });

const report = { base: BASE, at: new Date().toISOString(), viewports: {}, notes: [] };

async function open(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(CITY, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=payouts-card]', { timeout: 30000 });
  return { ctx, page, errors };
}

const box = async (page, sel) => {
  const el = await page.$(sel);
  if (!el) return null;
  const b = await el.boundingBox();
  return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
};

async function desktop(browser) {
  const { ctx, page, errors } = await open(browser, 1280, 800);
  // A guest has no row, so the cap is unread and every row holds. This check stubs ONLY the row read
  // (per_action_cap 0.02 NEAR, 10 payments a day) so the priced path can be seen; the 1Click price,
  // the receipts and the CSV are real. Nothing is signed and nothing is sent.
  await ctx.route('**/api/board/row/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ row: { owner: 'guest-check.near', per_action_cap: (2n * 10n ** 22n).toString(), daily_budget: (5n * 10n ** 22n).toString(), max_actions_per_day: 10, actions_today: 0, spent_today: '0', balance: (2n * 10n ** 24n).toString(), frozen: false, expires_at: '0' } }),
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=payouts-card]', { timeout: 30000 });
  await page.waitForTimeout(400);
  const out = {};
  await page.screenshot({ path: `${OUT}/1280-invoice.png` });

  // 2. the flow card has a fixed height and does not move when a link is created
  const flowBefore = await box(page, '[data-pane=invoice] [data-testid=payout-flow]');
  const fieldsBefore = await box(page, '#p-usd');
  await page.fill('#p-usd', '5.5');
  await page.fill('#p-receive', 'nearcarta.near');
  await page.fill('#p-memo', 'a live pass');
  await page.click('[data-testid=payout-create]');
  await page.waitForSelector('[data-testid=payout-result]', { timeout: 20000 });
  // The registration and sponsor lookups each repaint; wait for the repaint to settle before measuring.
  await page.waitForTimeout(1200);
  const flowAfter = await box(page, '[data-pane=invoice] [data-testid=payout-flow]');
  const fieldsAfter = await box(page, '#p-usd');
  out.flow = { before: flowBefore, after: flowAfter };
  out.fieldsStay = fieldsBefore && fieldsAfter ? fieldsBefore.y === fieldsAfter.y : null;
  out.flowSameHeight = flowBefore && flowAfter ? flowBefore.h === flowAfter.h : null;
  out.registration = await page.textContent('[data-testid=payout-line-2]');
  await page.screenshot({ path: `${OUT}/1280-invoice-created.png` });

  // 3. no gap between the tabs and the first card, on every tab
  const tabs = await box(page, '[data-testid=payouts-tabs]');
  const notes = {};
  for (const tab of ['invoice', 'payroll', 'csv', 'invoices']) {
    await page.click(`[data-testid=payouts-tab-${tab}]`);
    await page.waitForTimeout(250);
    const pane = await page.evaluate((t) => {
      const p = document.querySelector(`[data-pane=${t}]`);
      const tabsEl = document.querySelector('[data-testid=payouts-tabs]');
      if (!p || !tabsEl) return null;
      const a = tabsEl.getBoundingClientRect(), b = p.getBoundingClientRect();
      const kids = [...p.children].filter(k => !k.hidden);
      const first = kids[0]?.getBoundingClientRect();
      return { tabBottom: Math.round(a.bottom), paneTop: Math.round(b.top), firstTop: first ? Math.round(first.top) : null, gap: Math.round(b.top - a.bottom) };
    }, tab);
    notes[tab] = pane;
    await page.screenshot({ path: `${OUT}/1280-${tab}.png` });
  }
  out.gaps = notes;

  // 4. a status from the invoice tab does not follow us to CSV
  await page.click('[data-testid=payouts-tab-csv]');
  await page.waitForTimeout(200);
  out.csvStatus = (await page.textContent('[data-testid=payout-line]') || '').trim();
  out.csvHasInvoiceWord = /Invoice created/i.test(await page.textContent('[data-pane=csv]'));

  // 6. one gold button on payroll
  await page.click('[data-testid=payouts-tab-payroll]');
  await page.waitForTimeout(300);
  const gold = await page.evaluate(() => {
    const card = document.querySelector('[data-testid=payouts-card]');
    return [...card.querySelectorAll('button')].filter(b => !b.closest('[hidden]')).map(b => {
      const s = getComputedStyle(b);
      const bg = s.backgroundImage !== 'none' ? s.backgroundImage : s.backgroundColor;
      const on = b.closest('[data-pane]')?.getAttribute('data-pane');
      return { id: b.id || b.dataset.testid || b.textContent.trim().slice(0, 24), pane: on, cls: b.className, gold: /gradient|rgb\(2[0-9]{2},\s*1[6-9][0-9]/.test(bg) };
    });
  });
  out.payrollGold = gold.filter(b => b.gold).map(b => b.id);
  out.payrollButtons = gold.filter(b => b.pane === 'payroll');
  // the flow card on payroll is the same height as on invoice
  out.payrollFlow = await box(page, '[data-pane=payroll] [data-testid=payout-flow]');
  // The priced payroll path, in a labelled harness on the same page. A guest has no row, so the city
  // tray cannot price anything (it says "your /setup cap is unread"). This mounts the real tray with a
  // 0.02 NEAR cap and a 10-a-day count, so the real pricing route and the real receipts show.
  // It sends nothing: onPay and onForeignPay are stubs that say "check only".
  await page.evaluate(async () => {
    const host = document.createElement('div');
    host.id = 'payout-check';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#1a140f;padding:16px;overflow:auto';
    const head = document.createElement('p');
    head.style.cssText = 'color:#f5d08a;font:700 13px system-ui;margin:0 0 8px';
    head.textContent = 'CHECK HARNESS · row cap 0.05 NEAR, 10 payments a day · nothing is signed or sent';
    host.appendChild(head);
    const slot = document.createElement('div');
    host.appendChild(slot);
    const close = document.createElement('button');
    close.id = 'payout-check-close';
    close.textContent = 'Close the harness';
    close.style.cssText = 'margin:8px 0;min-height:44px;padding:0 14px';
    close.onclick = () => host.remove();
    host.appendChild(close);
    document.body.appendChild(host);
    const { mountPayouts } = await import('/panels/payouts-tray.js');
    mountPayouts(slot, {
      state: {
        tab: 'payroll',
        // Three rows: one foreign row inside the cap, one foreign row over it, one NEAR row.
        rows: [
          { to: '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e', amt: '0.15', asset: 'USDC', chain: 'base' },
          { to: '0x' + '33'.repeat(20), amt: '1', asset: 'USDC', chain: 'arb' },
          { to: 'cafe.near', amt: '0.001', asset: 'NEAR', chain: 'near' },
        ],
      },
      capNear: () => 0.05,
      account: () => 'guest-check.near',
      dock: false,
      onPay: async () => ({ ok: false, hint: 'check only: nothing was sent' }),
      onForeignPay: async () => ({ ok: false, reason: 'check only: nothing was sent' }),
    });
  });
  await page.waitForSelector('#payout-check [data-testid=payout-prepare]', { timeout: 15000 });
  await page.click('#payout-check [data-testid=payout-prepare]');
  await page.waitForFunction(() => document.querySelectorAll('#payout-check [data-testid=payout-receipt]').length >= 3, { timeout: 30000 });
  await page.waitForTimeout(500);
  out.receipts = await page.$$eval('#payout-check [data-testid=payout-receipt]', els => els.map(e => e.textContent.trim()));
  out.payLine = await page.evaluate(() => (document.querySelector('#payout-check [data-pane=payroll] [data-testid=payout-line]')?.textContent || '').trim());
  // Only the buttons the visitor can see: the inactive panes keep their buttons in the DOM.
  out.goldAfterReview = await page.evaluate(() => [...document.querySelectorAll('#payout-check .ferry-cta')]
    .filter(b => b.offsetParent !== null).map(b => b.id));
  await page.screenshot({ path: `${OUT}/1280-payroll-priced.png` });
  await page.click('#payout-check-close');
  await page.waitForSelector('#payout-check', { state: 'detached' });

  // 1. the agent parses the invoice sentence and the row pays in the same session
  const cmd = await page.evaluate(async () => {
    const m = await import('/panels/payouts-plan.js');
    return m.agentCommand('Create an invoice for 0.2 USDC to bob.near for design work');
  });
  out.agent = { memo: cmd.memo, usd: cmd.usd, receive: cmd.receive };
  out.reply = await page.evaluate(async () => {
    const m = await import('/panels/payouts-plan.js');
    return m.agentInvoiceReply({ usd: 0.2, receive: 'bob.near', memo: 'design work', due: '2026-11-13', href: '/pay/inv_x' }, 'https://nearcarta.vercel.app');
  });

  // 5. a foreign row is priced and planned as a send, not held
  out.foreign = await page.evaluate(async () => {
    const plan = await import('/panels/payouts-plan.js');
    const rows = [{ to: '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e', amt: '0.15', asset: 'USDC', chain: 'base' }];
    const price = await fetch('/api/payouts/payroll/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: rows[0].to, amt: '0.15', asset: 'USDC', chain: 'base' }) }).then(r => r.json());
    const q = price.ok ? plan.payrollQuote(rows[0], { quote: { amountInFormatted: price.quote.near, amountOutFormatted: price.quote.out, amountOutUsd: price.quote.outUsd, timeEstimate: price.quote.minutes }, correlationId: price.quote.correlationId }) : null;
    const classified = plan.classifyPayroll(rows, { capNear: 0.5, quotes: q ? { [plan.payrollKey(rows[0])]: q } : {} });
    return { priceOk: !!price.ok, near: price.quote?.near, out: price.quote?.out, action: classified.rows[0]?.action, nearCost: classified.rows[0]?.near };
  });

  await ctx.close();
  return { ...out, errors };
}

async function phone(browser) {
  const { ctx, page, errors } = await open(browser, 390, 844);
  await page.waitForSelector('[data-testid=payouts-tabs]', { state: 'visible' });
  const tabs = await box(page, '[data-testid=payouts-tabs]');
  const flow = await box(page, '[data-pane=invoice] [data-testid=payout-flow]');
  const cta = await box(page, '#p-create');
  const overlap = await page.evaluate(() => {
    const a = document.querySelector('nav.all-shops')?.getBoundingClientRect();
    const b = document.querySelector('[data-testid=payouts-tabs]')?.getBoundingClientRect();
    if (!a || !b) return null;
    return !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right);
  });
  for (const tab of ['invoice', 'payroll', 'csv', 'invoices']) {
    await page.click(`[data-testid=payouts-tab-${tab}]`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/390-${tab}.png` });
  }
  await ctx.close();
  return { tabs, flow, cta, allShopsOverlapsTabs: overlap, errors };
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  report.viewports['1280x800'] = await desktop(browser);
  report.viewports['390x844'] = await phone(browser);
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
