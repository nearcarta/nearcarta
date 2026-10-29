// Live fresh-guest tour in a real browser at one width: a new guest builds its charter and signs the default
// rules, then presses every shop with its default inputs (Chronicle, Mist Bank, Ferry, Guardhouse, Arena,
// Town Hall, Payouts, House) and pays the Toll last, the way a visitor tours the town. The browser state is
// saved so e2e/toll-visitor-live.mjs PHASE=settle can settle the same guest's Toll after Base finality.
// Every console error and every non-2xx response is recorded.
// BASE_URL=... WIDTH=1440 STATE_DIR=<outside git> OUT=judges/proofs/tour-live.json node e2e/tour-live.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173', W = Number(process.env.WIDTH || 1440);
const STATE = `${process.env.STATE_DIR}/ui-${W}.json`, OUT = process.env.OUT || 'judges/proofs/tour-live.json';
const H = W < 500 ? 844 : W < 1400 ? 800 : 900;
const shot = n => `e2e/shots/tour-${W}-${n}.png`;
const rec = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { base_url: BASE, passes: {} };
const pass = rec.passes[W] = { width: W, height: H };
const ph = pass.pay = { at: new Date().toISOString(), console_errors: [], non_2xx: [], shots: [], shops: [] };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500 });
const p = await ctx.newPage();
p.on('pageerror', e => ph.console_errors.push(String(e).slice(0, 300)));
p.on('console', m => m.type() === 'error' && ph.console_errors.push(m.text().slice(0, 300)));
p.on('response', r => { if (r.status() >= 300 && r.status() !== 304) ph.non_2xx.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`); });
const act = p.locator('#t-act');
const snap = async n => { try { await p.screenshot({ path: shot(n) }); ph.shots.push(shot(n)); } catch (e) { ph.shot_errors = [...(ph.shot_errors || []), n]; } };
const save = () => writeFileSync(OUT, JSON.stringify(rec, null, 2) + '\n');
const text = async sel => ((await p.locator(sel).textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const until = async (re, ms) => { await p.waitForFunction(r => new RegExp(r).test(document.querySelector('#t-act')?.textContent || ''), re.source, { timeout: ms }); };
// one press: click, then wait until the button is free again (not busy, enabled)
const press = async (ms = 240e3) => {
  const label = (await act.innerText().catch(() => '')).trim();
  await act.click();
  await p.waitForFunction(() => { const b = document.querySelector('#t-act'); return b && !b.classList.contains('busy') && !b.disabled; }, null, { timeout: ms });
  await p.waitForTimeout(600);
  return { press: label, see: await text('#t-say'), rule: await text('#t-rcpt [data-testid=rule]'),
    txs: await p.locator('#t-rcpt a[href*="/txns/"]').evaluateAll(as => as.map(a => a.href.split('/').pop())) };
};
const open = async shop => { await p.goto(BASE + '/design/D8_shops/?shop=' + shop); await p.waitForFunction(() => { const b = document.querySelector('#t-act'); return b && !b.disabled && !/Connect wallet|Lighting/.test(b.textContent); }, null, { timeout: 90e3 }); };
try {
  await p.goto(BASE + '/design/D8_shops/?shop=house');
  await until(/Connect wallet/, 60e3); await snap('1-enter');
  await act.click(); await p.locator('.connect-item', { hasText: 'Guest' }).first().click();
  await until(/Build my charter/, 90e3); ph.guest = await p.evaluate(() => window.__apps.S.me);
  await act.click(); await p.locator('#rules.open').waitFor({ timeout: 120e3 }); ph.charter = await p.evaluate(() => window.__apps.S.charter);
  ph.rules_defaults = { cap: await p.locator('#r-cap').inputValue().catch(() => null), budget: await p.locator('#r-bud').inputValue().catch(() => null), count: await p.locator('#r-cnt').inputValue().catch(() => null) };
  await p.locator('#r-sign').click(); await p.locator('#r-status .rule.ok').waitFor({ timeout: 120e3 });
  ph.rules_tx = (await p.locator('#r-status a.tx').first().getAttribute('href').catch(() => '') || '').split('/').pop();
  await p.waitForTimeout(2500); if (await p.locator('#rules.open').count()) await p.locator('#r-close').click({ force: true });
  // every shop with its default inputs; two-step shops press twice (quote then swap, send then verify, check then knock)
  for (const [shop, presses] of [['chronicle', 1], ['bank', 2], ['ferry', 2], ['guard', 2], ['arena', 1], ['hall', 1], ['payouts', 1], ['house', 1]]) {
    const row = { shop, steps: [] };
    try { await open(shop); for (let i = 0; i < presses; i++) row.steps.push(await press()); } catch (e) { row.error = String(e.message).slice(0, 200); }
    await snap('shop-' + shop); ph.shops.push(row); save();
  }
  await open('toll'); await until(/Pay the toll/, 90e3); await snap('toll-ready');
  await act.click(); await p.locator('[data-testid=toll-status]').waitFor({ timeout: 240e3 });
  await p.locator('[data-testid=base-tx]').waitFor({ timeout: 60e3 });
  ph.say = await text('#t-say');
  ph.visit = await p.evaluate(() => window.__apps.A.tollVisit());
  ph.status = await p.locator('[data-testid=toll-status]').getAttribute('data-status');
  ph.base_tx = (await p.locator('[data-testid=base-tx]').getAttribute('href')).split('/').pop();
  await snap('toll-signed-broadcast');
  mkdirSync(process.env.STATE_DIR, { recursive: true }); await ctx.storageState({ path: STATE }); chmodSync(STATE, 0o600);
  ph.ok = true;
} catch (e) { ph.ok = false; ph.error = String(e.message).slice(0, 400); ph.say = await text('#t-say'); await snap('error').catch(() => {}); }
ph.no_sideways_scroll = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth).catch(() => null);
save(); await b.close();
console.log(JSON.stringify({ W, ok: ph.ok, error: ph.error, errors: ph.console_errors.length, non_2xx: ph.non_2xx.length, shops: ph.shops.map(s => `${s.shop}:${s.error ? 'ERR' : s.steps.map(x => x.rule || x.see.slice(0, 30)).join('|')}`), base_tx: ph.base_tx, status: ph.status }));
