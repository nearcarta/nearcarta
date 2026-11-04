// Live fresh-guest pass of the Toll gate in a real browser, at 1440, 1280 and 390 px.
// Phase "pay": a new guest testnet account (public faucet) builds its charter, signs its rules, and pays the toll:
//   the charter's agent key proposes 0.01 NEAR, the guest wallet calls gate.pay_for, the MPC network signs the
//   Base Sepolia payout, and the API relays it. Phase "settle" (after ~20 min of Base finality) reopens the same
//   guest and settles with the MPC foreign-tx proof. Every console error and every non-2xx response is recorded.
// Phase "stay" pays like "pay", then stays in the room: the live countdown runs and the background settler confirms
// the visit with no second click. BASE_URL=... WIDTH=1440 PHASE=pay|settle|stay STATE_DIR=<outside git> node e2e/toll-visitor-live.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173', W = Number(process.env.WIDTH || 1440), PHASE = process.env.PHASE || 'pay';
const STATE = `${process.env.STATE_DIR}/ui-${W}.json`, OUT = process.env.OUT || 'judges/proofs/toll-visitor-ui.json';
const H = W < 500 ? 844 : W < 1400 ? 800 : 900;
const shot = n => `e2e/shots/${process.env.SHOT_PREFIX || 'toll'}-${W}-${n}.png`;
const rec = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { base_url: BASE, passes: {} };
const pass = rec.passes[W] ||= { width: W, height: H };
const ph = pass[PHASE] = { at: new Date().toISOString(), console_errors: [], non_2xx: [], shots: [] };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500, ...(PHASE === 'settle' ? { storageState: STATE } : {}) });
const p = await ctx.newPage();
p.on('pageerror', e => ph.console_errors.push(String(e).slice(0, 300)));
p.on('console', m => m.type() === 'error' && ph.console_errors.push(m.text().slice(0, 300)));
p.on('response', r => { if (r.status() >= 300 && r.status() !== 304) ph.non_2xx.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`); });
const act = p.locator('#t-act');
const snap = async n => { await p.screenshot({ path: shot(n) }); ph.shots.push(shot(n)); };
const save = () => writeFileSync(OUT, JSON.stringify(rec, null, 2) + '\n');
const until = async (re, ms) => { await p.waitForFunction(r => new RegExp(r).test(document.querySelector('#t-act')?.textContent || ''), re.source, { timeout: ms }); };
try {
  await p.goto(BASE + '/design/D8_shops/?shop=toll');
  if (PHASE === 'pay' || PHASE === 'stay') {
    await until(/Sign in/, 60e3); await snap('1-enter');
    await act.click(); await p.waitForURL(/\/setup\//);
    await p.getByTestId('setup-guest').click();
    await p.getByTestId('setup-who').waitFor({ timeout: 120_000 });
    await p.goto(BASE + '/design/D8_shops/?shop=toll');
    await until(/Build my charter/, 90e3); ph.guest = await p.evaluate(() => window.__apps.S.me);
    await act.click(); await p.locator('#rules.open').waitFor({ timeout: 120e3 }); ph.charter = await p.evaluate(() => window.__apps.S.charter);
    await snap('2-rules');
    await p.locator('#r-sign').click(); await p.locator('#r-status .rule.ok').waitFor({ timeout: 120e3 });
    ph.rules_tx = await p.locator('#r-status a.tx').first().getAttribute('href').catch(() => null);
    await p.waitForTimeout(2500); if (await p.locator('#rules.open').count()) await p.locator('#r-close').click({ force: true });
    await until(/Pay the toll/, 90e3); await snap('3-ready');
    await act.click(); await p.locator('[data-testid=toll-status]').waitFor({ timeout: 240e3 });
    await p.locator('[data-testid=base-tx]').waitFor({ timeout: 60e3 });
    ph.say = (await p.locator('#t-say').textContent()).trim();
    ph.visit = await p.evaluate(() => window.__apps.A.tollVisit());
    ph.status = await p.locator('[data-testid=toll-status]').getAttribute('data-status');
    ph.base_tx = (await p.locator('[data-testid=base-tx]').getAttribute('href')).split('/').pop();
    await snap('4-signed-broadcast');
    await p.locator('#t-proof').click(); await p.locator('[data-testid=gate-status]').first().waitFor({ timeout: 60e3 }); await p.waitForTimeout(800); await snap('5-drawer-live');
    ph.drawer = (await p.locator('[data-testid=guest-proof]').innerText()).split('\n').filter(l => /visit|#\d|gate/i.test(l)).slice(0, 8);
    ph.split = await p.locator('[data-testid=toll-split]').innerText().catch(() => null);
    ph.split_tx = await p.locator('#t-rcpt a.tx').first().getAttribute('href').catch(() => null);
    mkdirSync(process.env.STATE_DIR, { recursive: true }); await ctx.storageState({ path: STATE }); chmodSync(STATE, 0o600);
    if (PHASE === 'stay') {
      if (await p.locator('#t-proof').getAttribute('aria-expanded') === 'true') { await p.keyboard.press('Escape'); if (await p.locator('#t-proof').getAttribute('aria-expanded') === 'true') await p.locator('#t-proof').click({ force: true }).catch(() => {}); } // close the drawer
      const eta = async () => p.locator('[data-testid=toll-eta]').textContent({ timeout: 3000 }).catch(() => null);
      ph.eta_first = await eta(); await p.waitForTimeout(5000); ph.eta_after_5s = await eta(); await snap('6-countdown');
      await p.locator('[data-testid=toll-status][data-status=confirmed]').waitFor({ timeout: 35 * 60e3 });
      ph.say_confirmed = (await p.locator('#t-say').textContent()).trim();
      ph.visit_done = await p.evaluate(() => window.__apps.A.tollVisit()); ph.status = 'confirmed';
      await snap('7-confirmed');
      if (await p.locator('#t-proof').getAttribute('aria-expanded') !== 'true') await p.locator('#t-proof').click(); await p.locator('[data-testid=gate-status]').first().waitFor({ timeout: 60e3 }); await p.waitForTimeout(1500); await snap('8-drawer-confirmed');
      ph.drawer_confirmed = (await p.locator('[data-testid=guest-proof]').innerText()).split('\n').filter(l => /visit|#\d|gate|gas/i.test(l)).slice(0, 10);
    }
  } else {
    await until(/Check Base Sepolia|Settle|Pay the toll/, 90e3);
    // "Check Base Sepolia" settles in the same click once Base is final (the wallet approves settle), so stop on confirmed
    const stat = async () => (await p.locator('[data-testid=toll-status]').getAttribute('data-status', { timeout: 2000 }).catch(() => null));
    for (let i = 0; i < 60 && (await stat()) !== 'confirmed'; i++) {
      await act.click();
      await p.waitForFunction(() => document.querySelector('[data-testid=toll-status]')?.dataset.status === 'confirmed' || /Check Base Sepolia|Settle/.test(document.querySelector('#t-act')?.textContent || ''), null, { timeout: 240e3 });
      if ((await stat()) !== 'confirmed') { if (i === 0) await snap('6-waiting-on-base'); await p.waitForTimeout(30e3); }
    }
    await p.locator('[data-testid=toll-status][data-status=confirmed]').waitFor({ timeout: 180e3 });
    ph.say = (await p.locator('#t-say').textContent()).trim();
    ph.visit = await p.evaluate(() => window.__apps.A.tollVisit()); ph.status = 'confirmed';
    await snap('7-confirmed');
    if (await p.locator('#t-proof').getAttribute('aria-expanded') !== 'true') await p.locator('#t-proof').click(); await p.locator('[data-testid=gate-status]').first().waitFor({ timeout: 60e3 }); await p.waitForTimeout(1500); await snap('8-drawer-confirmed');
    ph.drawer = (await p.locator('[data-testid=guest-proof]').innerText()).split('\n').filter(l => /visit|#\d|gate/i.test(l)).slice(0, 8);
  }
  ph.ok = true;
} catch (e) { ph.ok = false; ph.error = String(e.message).slice(0, 400); await snap('error').catch(() => {}); }
ph.no_sideways_scroll = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth).catch(() => null);
save(); await b.close();
console.log(JSON.stringify({ W, PHASE, ok: ph.ok, error: ph.error, errors: ph.console_errors.length, non_2xx: ph.non_2xx.length, base_tx: ph.base_tx, status: ph.status }));
