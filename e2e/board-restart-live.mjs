// Live proof that the Vault leaderboard comes back after a Render restart (no disk).
// Pass BEFORE as a path to a board read taken before the restart. With no BEFORE, this reads the live board only.
// Signs nothing.
import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://nearcarta.vercel.app', OUT = 'judges/proofs/board-restart-live';
mkdirSync(OUT, { recursive: true });
const beforePath = process.env.BEFORE || '';
const before = beforePath && existsSync(beforePath) ? JSON.parse(readFileSync(beforePath, 'utf8')) : null;
const lb = async () => (await fetch(BASE + '/api/vault/leaderboard?t=' + Date.now())).json();
let after, t0 = Date.now();
if (before?.rebuilt?.started_at) {
  for (;;) {
    try { after = await lb(); } catch { after = null; }
    if (after?.rebuilt?.started_at > before.rebuilt.started_at && after.rebuilt.complete_at && after.indexed >= before.indexed) break;
    if (Date.now() - t0 > 15 * 60e3) throw new Error('board not rebuilt in 15 min: ' + JSON.stringify(after?.rebuilt));
    await new Promise(r => setTimeout(r, 10e3));
  }
} else {
  after = await lb();
}
const pick = x => ({ indexed: x.indexed, counted: x.counted, complete: x.complete, players: x.players.length, top: x.players.slice(0, 3), rebuilt: x.rebuilt });
const res = { at: new Date().toISOString(), base: BASE, before: before ? pick(before) : null, after: pick(after),
  restored: before ? after.indexed >= before.indexed && after.counted >= before.counted : null,
  rebuild_s: before && after?.rebuilt?.complete_at ? Math.round((after.rebuilt.complete_at - after.rebuilt.started_at) / 1000) : null, widths: {} };
const b = await chromium.launch();
for (const [W, H] of [[1440, 900], [1280, 800], [390, 844]]) {
  const r = res.widths[W] = { console_errors: [], shots: [] };
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500 });
  const p = await ctx.newPage();
  p.on('pageerror', e => r.console_errors.push(String(e).slice(0, 300)));
  p.on('console', m => m.type() === 'error' && r.console_errors.push(m.text().slice(0, 300)));
  for (const [shop, title] of [['arena', 'Vault Arena'], ['vault', '']]) {
    await p.goto(BASE + '/design/D9_world/?shop=' + shop); await p.locator('#t-proof').waitFor({ state: 'visible', timeout: 90e3 });
    if (title) await p.waitForFunction(t => (document.querySelector('#t-title')?.textContent || '').includes(t), title, { timeout: 90e3 });
    await p.waitForTimeout(4000);
    const f = `${OUT}/${W}-${shop}.jpg`; await p.screenshot({ path: f, type: 'jpeg', quality: 70 }); r.shots.push({ f, kb: Math.round(statSync(f).size / 1024) });
  }
  await ctx.close(); r.ok = r.console_errors.length === 0;
}
await b.close();
writeFileSync(OUT + '/result.json', JSON.stringify(res, null, 2) + '\n');
console.log(JSON.stringify({ restored: res.restored, before: res.before.indexed, after: res.after.indexed, rebuild_s: res.rebuild_s, widths: Object.fromEntries(Object.entries(res.widths).map(([w, r]) => [w, r.console_errors])) }));
