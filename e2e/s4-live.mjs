// Live read-only pass for SUMMARY4 #7 #8 #9. The primary NEAR RPC (fastnear) is forced to answer 408 in the browser,
// so every chain read has to rotate to a backup. Signs nothing. node e2e/s4-live.mjs (BASE defaults to the live site)
import { chromium } from 'playwright';
import { writeFileSync, statSync } from 'node:fs';
const BASE = process.env.BASE || 'https://nearcarta.vercel.app', OUT = 'judges/proofs/s4-live';
const PRIMARY = /test\.rpc\.fastnear\.com/, BACKUP = /rpc\.testnet\.near\.org|near-testnet\.drpc\.org|rpc\.testnet\.fastnear\.com/;
const get = async p => { const r = await fetch(BASE + p); return { status: r.status, body: await r.json() }; };
const cfg = await get('/api/vault/config'), sc = await get('/api/vault/score'), sc2 = await get('/api/vault/score?charter=' + cfg.body.vault?.arena?.charter);
const res = { at: new Date().toISOString(), base: BASE, api: { score_bare: sc.status, score_usage: sc.body.usage, score_alias: sc2.status, rpc: cfg.body.rpc, rpc_fallbacks: cfg.body.rpc_fallbacks }, widths: {} };
const b = await chromium.launch();
for (const [W, H] of [[1440, 900], [1280, 800], [390, 844]]) {
  const r = res.widths[W] = { console_errors: [], non_2xx: [], forced_408: 0, backup_calls: 0, shots: [] };
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500 });
  await ctx.route(PRIMARY, rt => { r.forced_408++; return rt.fulfill({ status: 408, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' }); });
  const p = await ctx.newPage();
  p.on('pageerror', e => r.console_errors.push(String(e).slice(0, 300)));
  // The forced 408 itself makes Chrome log "Failed to load resource: 408"; that one is expected and counted apart.
  p.on('console', m => m.type() === 'error' && !/status of 408/.test(m.text()) && r.console_errors.push(m.text().slice(0, 300)));
  p.on('request', x => BACKUP.test(x.url()) && r.backup_calls++);
  p.on('response', x => x.status() >= 400 && !PRIMARY.test(x.url()) && r.non_2xx.push(`${x.status()} ${x.url().slice(0, 120)}`));
  const snap = async n => { const f = `${OUT}/${W}-${n}.jpg`; await p.screenshot({ path: f, type: 'jpeg', quality: 70 }); r.shots.push({ f, kb: Math.round(statSync(f).size / 1024) }); };
  for (const [shop, title] of [['hall', 'Town Hall'], ['toll', 'Toll'], ['vault', '']]) {
    await p.goto(BASE + '/design/D9_world/?shop=' + shop); await p.locator('#t-proof').waitFor({ state: 'visible', timeout: 90e3 });
    if (title) await p.waitForFunction(t => (document.querySelector('#t-title')?.textContent || '').includes(t), title, { timeout: 90e3 });
    await p.waitForTimeout(4000); await snap(shop);
  }
  r.bundle_has_hint = await p.evaluate(async () => (await (await fetch('/design/D8_shops/js/rules-default.js')).text()).includes('changed in Town Hall'));
  r.chip = await p.evaluate(async () => { const m = await import('/design/D8_shops/js/rules-default.js'); return [m.ruleChip(0.05).text, m.ruleChip(0.03).text]; });
  await ctx.close();
  r.ok = r.console_errors.length === 0 && r.non_2xx.length === 0 && r.shots.every(s => s.kb < 300) && (r.forced_408 === 0 || r.backup_calls > 0) && r.bundle_has_hint;
}
await b.close();
writeFileSync(OUT + '/result.json', JSON.stringify(res, null, 2) + '\n');
console.log(JSON.stringify(res.api), JSON.stringify(Object.fromEntries(Object.entries(res.widths).map(([w, r]) => [w, { ok: r.ok, errors: r.console_errors, non_2xx: r.non_2xx, f408: r.forced_408, backup: r.backup_calls, hint: r.bundle_has_hint, chip: r.chip, kb: r.shots.map(s => s.kb) }]))));
