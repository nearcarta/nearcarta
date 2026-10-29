// Live read-only pass: expired Town Hall proposals show as expired on /shops/hall/ and in the Town Hall room, and the
// Mist Bank room says how a payout runs. One fresh browser per width; signs nothing. Records console errors + non-2xx.
// node e2e/townhall-expiry-live.mjs  (BASE defaults to https://nearcarta.vercel.app)
import { chromium } from 'playwright';
import { writeFileSync, statSync } from 'node:fs';
const BASE = process.env.BASE || 'https://nearcarta.vercel.app', OUT = 'judges/proofs/townhall-expiry-live';
const LINE = 'One fresh payee per payout; the Zcash send is run by an operator worker.';
const api = await (await fetch(BASE + '/api/townhall')).json();
const expired = api.proposals.filter(p => p.expired).map(p => p.id);
const res = { at: new Date().toISOString(), base: BASE, api_expired_ids: expired, api: api.proposals.map(p => ({ id: p.id, status: p.status, chain_status: p.chain_status, ends_at: p.ends_at })), widths: {} };
const b = await chromium.launch();
for (const [W, H] of [[1440, 900], [1280, 800], [390, 844]]) {
  const r = res.widths[W] = { console_errors: [], non_2xx: [], shots: [] };
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500 });
  const p = await ctx.newPage();
  p.on('pageerror', e => r.console_errors.push(String(e).slice(0, 300)));
  p.on('console', m => m.type() === 'error' && r.console_errors.push(m.text().slice(0, 300)));
  p.on('response', x => x.status() >= 400 && r.non_2xx.push(`${x.status()} ${x.url().slice(0, 120)}`));
  const snap = async n => { const f = `${OUT}/${W}-${n}.jpg`; await p.screenshot({ path: f, type: 'jpeg', quality: 70 }); r.shots.push({ f, kb: Math.round(statSync(f).size / 1024) }); };
  // 1. proposals page
  await p.goto(BASE + '/shops/hall/'); await p.locator('[data-testid=list] li').first().waitFor({ timeout: 60e3 });
  r.page = await p.$$eval('[data-testid=list] li', ls => ls.map(l => ({ id: +l.dataset.id, status: l.dataset.status, text: l.querySelector('.st')?.textContent })));
  await p.locator('[data-testid=list]').scrollIntoViewIfNeeded(); await snap('1-hall-page');
  // 2. Town Hall room in the town, proof drawer
  await p.goto(BASE + '/design/D9_world/?shop=townhall'); await p.locator('#t-proof').waitFor({ state: 'visible', timeout: 90e3 });
  await p.waitForFunction(() => /Town Hall/.test(document.querySelector('#t-title')?.textContent || ''), null, { timeout: 90e3 });
  await p.waitForTimeout(2500); await snap('2-hall-room');
  await p.locator('#t-proof').click(); await p.waitForFunction(() => /Latest proposals[^]*#\d+ /.test(document.querySelector('#d-body')?.textContent || ''), null, { timeout: 30e3 });
  await p.waitForTimeout(600);
  r.room = (await p.locator('#d-body').innerText()).split('\n').filter(l => /^#\d+|expired|open|approved|vote/i.test(l)).slice(0, 14);
  await snap('3-hall-drawer');
  // 3. Mist Bank room line
  await p.goto(BASE + '/design/D9_world/?shop=mistbank'); await p.locator('#t-proof').waitFor({ state: 'visible', timeout: 90e3 });
  await p.waitForFunction(() => /Mist Bank/.test(document.querySelector('#t-title')?.textContent || ''), null, { timeout: 90e3 });
  await p.waitForFunction(l => document.body.innerText.includes(l), LINE, { timeout: 30e3 }).catch(() => {});
  await p.waitForTimeout(2000); r.bank_line_visible = await p.evaluate(l => { const e = [...document.querySelectorAll('#t-say, #t-label, #shopUI *')].find(x => x.offsetParent && x.textContent.includes(l)); return !!e; }, LINE);
  await snap('4-bank-room');
  await p.locator('#t-proof').click(); await p.waitForTimeout(800); r.bank_line_in_drawer = (await p.locator('#d-body').textContent()).includes(LINE); await snap('5-bank-drawer');
  await ctx.close();
  r.ok = r.console_errors.length === 0 && r.shots.every(s => s.kb < 300) && expired.every(id => r.page.find(x => x.id === id)?.status === 'Expired')
    && expired.every(id => r.room.some(l => l.startsWith('#' + id + ' ')) ) && r.bank_line_in_drawer;
}
await b.close();
writeFileSync(OUT + '/result.json', JSON.stringify(res, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(res.widths).map(([w, r]) => [w, { ok: r.ok, errors: r.console_errors.length, non_2xx: r.non_2xx.length, kb: r.shots.map(s => s.kb), bank_say: r.bank_line_visible }]))), 'expired', expired);
