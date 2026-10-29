// Live proof that the Vault leaderboard comes back after a Render restart (no disk): BEFORE is the board read
// before the restart, then this waits for the new boot to rebuild it from chain and loads the rooms at 3 widths.
// Signs nothing. BEFORE=judges/proofs/board-restart-live/before.json node e2e/board-restart-live.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://nearcarta.vercel.app', OUT = 'judges/proofs/board-restart-live';
mkdirSync(OUT, { recursive: true });
const before = JSON.parse(readFileSync(process.env.BEFORE || OUT + '/before.json', 'utf8'));
const lb = async () => (await fetch(BASE + '/api/vault/leaderboard?t=' + Date.now())).json();
let after, t0 = Date.now();
for (;;) {
  try { after = await lb(); } catch { after = null; }
  if (after?.rebuilt?.started_at > before.rebuilt.started_at && after.rebuilt.complete_at && after.indexed >= before.indexed) break;
  if (Date.now() - t0 > 15 * 60e3) throw new Error('board not rebuilt in 15 min: ' + JSON.stringify(after?.rebuilt));
  await new Promise(r => setTimeout(r, 10e3));
}
const pick = x => ({ indexed: x.indexed, counted: x.counted, complete: x.complete, players: x.players.length, top: x.players.slice(0, 3), rebuilt: x.rebuilt });
const res = { at: new Date().toISOString(), base: BASE, before: pick(before), after: pick(after),
  restored: after.indexed >= before.indexed && after.counted >= before.counted, rebuild_s: Math.round((after.rebuilt.complete_at - after.rebuilt.started_at) / 1000), widths: {} };
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
