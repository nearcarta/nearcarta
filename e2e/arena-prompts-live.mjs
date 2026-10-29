// Live read-only pass: the Vault Arena drawer lists past prompts with their decision and reveal txs, and the Toll
// drawer shows the stuck Arbitrum record as expired. One fresh browser per width; signs nothing.
// node e2e/arena-prompts-live.mjs  (BASE defaults to https://nearcarta.vercel.app)
import { chromium } from 'playwright';
import { writeFileSync, statSync } from 'node:fs';
const BASE = process.env.BASE || 'https://nearcarta.vercel.app', OUT = 'judges/proofs/arena-prompts-live';
const ap = await (await fetch(BASE + '/api/arena/prompts')).json(), tl = await (await fetch(BASE + '/api/toll')).json();
const expired = tl.instances.flatMap(i => i.recent.filter(r => r.status === 'expired').map(r => `${i.label} #${r.nonce}`));
const res = { at: new Date().toISOString(), base: BASE, api: { count: ap.count, shown: ap.shown, with_decision_tx: ap.prompts.filter(p => p.decision).length, with_reveal_tx: ap.prompts.filter(p => p.reveal).length, toll_expired: expired }, widths: {} };
const b = await chromium.launch();
for (const [W, H] of [[1440, 900], [1280, 800], [390, 844]]) {
  const r = res.widths[W] = { console_errors: [], non_2xx: [], shots: [] };
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500 });
  const p = await ctx.newPage();
  p.on('pageerror', e => r.console_errors.push(String(e).slice(0, 300)));
  p.on('console', m => m.type() === 'error' && r.console_errors.push(m.text().slice(0, 300)));
  p.on('response', x => x.status() >= 400 && r.non_2xx.push(`${x.status()} ${x.url().slice(0, 120)}`));
  const snap = async n => { const f = `${OUT}/${W}-${n}.jpg`; await p.screenshot({ path: f, type: 'jpeg', quality: 70 }); r.shots.push({ f, kb: Math.round(statSync(f).size / 1024) }); };
  const room = async (shop, title) => { await p.goto(BASE + '/design/D9_world/?shop=' + shop); await p.locator('#t-proof').waitFor({ state: 'visible', timeout: 90e3 });
    await p.waitForFunction(t => (document.querySelector('#t-title')?.textContent || '').includes(t), title, { timeout: 90e3 }); await p.waitForTimeout(2500); };
  await room('arena', 'Vault Arena'); await snap('1-arena-room');
  await p.locator('#t-proof').click(); await p.waitForFunction(() => document.querySelectorAll('#d-body [data-testid=arena-prompt]').length > 0, null, { timeout: 40e3 });
  await p.waitForTimeout(600);
  r.arena_rows = await p.$$eval('#d-body [data-testid=arena-prompt]', ls => ls.map(l => ({ text: l.querySelector('.k')?.firstChild?.textContent?.slice(0, 60), st: l.querySelector('.st')?.textContent, links: l.querySelectorAll('a.tx').length })));
  await snap('2-arena-drawer');
  await room('toll', 'Toll'); await p.locator('#t-proof').click();
  await p.waitForFunction(() => document.querySelectorAll('#d-body [data-testid=toll-record]').length > 0, null, { timeout: 40e3 });
  await p.waitForTimeout(600);
  r.toll_rows = await p.$$eval('#d-body [data-testid=toll-record]', ls => ls.map(l => ({ k: l.querySelector('.k')?.firstChild?.textContent, st: l.querySelector('.st')?.textContent })));
  await p.locator('#d-body [data-testid=toll-record]').first().scrollIntoViewIfNeeded(); await snap('3-toll-drawer');
  await ctx.close();
  r.ok = r.console_errors.length === 0 && r.shots.every(s => s.kb < 300) && r.arena_rows.length >= 30 && r.arena_rows.filter(x => x.links >= 2).length >= 29
    && expired.length > 0 && expired.every(e => r.toll_rows.some(t => t.k === e && /expired/.test(t.st)));
}
await b.close();
writeFileSync(OUT + '/result.json', JSON.stringify(res, null, 2) + '\n');
console.log(JSON.stringify(res.api), JSON.stringify(Object.fromEntries(Object.entries(res.widths).map(([w, r]) => [w, { ok: r.ok, errors: r.console_errors.length, non_2xx: r.non_2xx.length, kb: r.shots.map(s => s.kb), arena: r.arena_rows.length }]))));
