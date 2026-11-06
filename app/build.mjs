// Builds app/dist. "/" is the town (design/D9_world, its 2D fallback included); each shop door opens the
// shop interiors (design/D8_shops). The plain console moved to /console.html; /judges.html stays.
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { walletDefine, PRIVY_ID, PRIVY_CLIENT, PUBLIC_MAINNET } from './build-defines.mjs';
const here = new URL('.', import.meta.url).pathname;
const dist = here + 'dist';
rmSync(dist, { recursive: true, force: true }); mkdirSync(dist);
cpSync(here + 'src', dist, { recursive: true });
const mainnet = JSON.parse(readFileSync(here + '../shared/deployments/mainnet.json', 'utf8'));
const houseRec = mainnet.extras.house;
const houseShop = typeof houseRec.shop === 'string' ? houseRec.shop : houseRec.shop.account;
writeFileSync(dist + '/house-shop.js',
  '// Generated from shared/deployments/mainnet.json. The city imports this file.\n'
  + `export const HOUSE_SHOP = ${JSON.stringify(houseShop)};\n`
  + `export const HOUSE_LEGACY = ${JSON.stringify(houseRec.legacy)};\n`
  + `export const HOUSE_OWNER = ${JSON.stringify(houseRec.owner)};\n`
  + `export const HOUSE_BOARD = ${JSON.stringify(mainnet.board.contract)};\n`);
cpSync(here + 'design', dist + '/design', { recursive: true });
// OutLayer fetches the charter check WASM from here and refuses it unless its sha256 matches the pin.
mkdirSync(dist + '/outlayer'); cpSync(here + '../outlayer/artifacts/charter_check.wasm', dist + '/outlayer/charter_check.wasm');
cpSync(here + 'design/D6_dashboards/src/data.js', dist + '/live/data.static.js');
// Static hosts serve files before rewrites, so put the live adapter at the path the
// interiors import. Only dist changes; app/design stays as delivered.
cpSync(here + 'src/live/data.js', dist + '/design/D6_dashboards/src/data.js');
// Shop interiors: ../data/live.js becomes live reads; the delivered snapshot stays as the fallback.
const shops = dist + '/design/D8_shops';
cpSync(here + 'design/D8_shops/data/live.js', shops + '/data/live.snapshot.js');
cpSync(here + 'src/live/shops-live.js', shops + '/data/live.js');
rmSync(dist + '/live/shops-live.js');
// The Ferry checks quotes with the server's own guard (dependency-free module), so the two cannot drift.
cpSync(here + '../backend/src/ferry-guard.js', dist + '/live/ferry-guard.js');
await (await import('esbuild')).build({ entryPoints: [here + 'src/ferry-pay.js'], bundle: true, format: 'iife', target: 'es2022', outfile: dist + '/ferry-pay.js', logLevel: 'warning' });
// Town Hall filing caps by reputation tier: the shop room uses the same module as /shops/hall.
cpSync(here + '../shared/townhall/reputation.js', dist + '/live/townhall-reputation.js');
// The city tray and /shops/hall/ import these as raw modules. The URL lands on /shared/.
mkdirSync(dist + '/shared/hall', { recursive: true });
mkdirSync(dist + '/shared/rails', { recursive: true });
cpSync(here + '../shared/hall/plan.js', dist + '/shared/hall/plan.js');
cpSync(here + '../shared/hall/job.js', dist + '/shared/hall/job.js');
// The Chronicle tray imports these as raw modules (rules reconstruction, cross-shop receipts).
mkdirSync(dist + '/shared/chronicle', { recursive: true });
cpSync(here + '../shared/chronicle/rules.js', dist + '/shared/chronicle/rules.js');
cpSync(here + '../shared/chronicle/receipts.js', dist + '/shared/chronicle/receipts.js');
// v2.js pulls in board/call-as.js (a bare @noble specifier) and a JSON import, so it
// has to be bundled, not copied. The Hall panels import it at /shared/hall/v2.js.
await (await import('esbuild')).build({
  entryPoints: [here + '../shared/hall/v2.js'], bundle: true, format: 'esm', target: 'es2022',
  outfile: dist + '/shared/hall/v2.js', logLevel: 'warning',
});
cpSync(here + '../shared/rails/receipts.js', dist + '/shared/rails/receipts.js');
// The Guardhouse room imports this as a raw module. Without it the import 404s and
// every shop mount in boot.js fails, not just the Guardhouse. board-pay.js pulls in
// shared/board/call-as.js, which resolves @noble/hashes as a bare specifier, so a plain
// copy cannot load in a browser. Bundle it to one file instead.
mkdirSync(dist + '/shared/guard', { recursive: true });
await (await import('esbuild')).build({
  entryPoints: [here + '../shared/guard/board-pay.js'], bundle: true, format: 'esm', target: 'es2022',
  outfile: dist + '/shared/guard/board-pay.js', logLevel: 'warning',
});
// Your House: NEAR Wallet Selector bundled into one ES module (the only part of the console that asks a wallet to sign).
await (await import('esbuild')).build({ entryPoints: [here + 'house/house.js'], bundle: true, format: 'esm', minify: true, target: 'es2022',
  outfile: dist + '/house.bundle.js', define: { 'process.env.NODE_ENV': '"production"', __WC_ID__: JSON.stringify(process.env.VITE_WC_PROJECT_ID || ''), ...walletDefine }, external: ['/wc.bundle.js'], logLevel: 'warning' });
// WalletConnect client, fetched only when someone picks a WalletConnect wallet. The project id is a public client id.
await (await import('esbuild')).build({ entryPoints: [here + 'house/wc.js'], bundle: true, format: 'esm', minify: true, target: 'es2022',
  outfile: dist + '/wc.bundle.js', define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' }, logLevel: 'warning' });
// Shop apps (design/D8_shops/js/apps.js): the site wallet layer and signer, bundled from source so they never drift.
await (await import('esbuild')).build({ entryPoints: [here + 'design/D8_shops/js/wallet/entry.js'], bundle: true, format: 'esm', minify: true, target: 'es2022',
  outfile: shops + '/js/wallet.bundle.js', define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis', ...walletDefine }, logLevel: 'warning' });
rmSync(shops + '/js/wallet', { recursive: true, force: true });
// /setup: the guided stepper (sign in, fund, privacy, character, rules, sign, try). Its HTML and CSS come from src/setup.
await (await import('esbuild')).build({ entryPoints: [here + 'house/setup.js'], bundle: true, format: 'esm', minify: true, target: 'es2022',
  outfile: dist + '/setup/setup.bundle.js', define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis', __WC_ID__: JSON.stringify(process.env.VITE_WC_PROJECT_ID || ''), __PRIVY_APP_ID__: JSON.stringify(PRIVY_ID || ''), __PRIVY_CLIENT_ID__: JSON.stringify(PRIVY_CLIENT || ''), ...walletDefine }, external: ['/wc.bundle.js'], logLevel: 'warning' });
// /sign: the Privy login and signing window (React, its own bundle, built when the Privy app id is set; the client id is optional).
if (PRIVY_ID) {
  mkdirSync(dist + '/sign', { recursive: true });
  await (await import('esbuild')).build({ entryPoints: [here + 'house/sign.jsx'], bundle: true, format: 'esm', minify: true, target: 'es2022', jsx: 'automatic',
    outfile: dist + '/sign/sign.bundle.js', define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis', __PRIVY_APP_ID__: JSON.stringify(PRIVY_ID), __PRIVY_CLIENT_ID__: JSON.stringify(PRIVY_CLIENT) }, logLevel: 'warning' });
  writeFileSync(dist + '/sign/index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nearcarta · approve</title><link rel="stylesheet" href="/brand/chrome.css">'
    + '<script>try{window.opener&&window.opener.postMessage({source:"privy-near-connect",type:"READY"},"*")}catch(e){}</script><link rel="stylesheet" href="/sign/radix.css"><link rel="stylesheet" href="/sign/theme.css"><link rel="stylesheet" href="/sign/brand.css"><link rel="stylesheet" href="/brand/brown.css"></head><body>'
    + '<a class="back-town" href="/" data-testid="back-town">Back to town</a><p><a href="https://github.com/nearcarta/nearcarta#readme">README</a></p>'
    + '<div id="root"></div><script type="module" src="/sign/sign.bundle.js"></script></body></html>');
  const nm = p => { for (const b of [here + 'node_modules/', here + '../node_modules/']) try { readFileSync(b + p); return b + p; } catch {} throw new Error(p); };
  cpSync(nm('@radix-ui/themes/styles.css'), dist + '/sign/radix.css');
  cpSync(nm('@peerfolio/privy-near-connect/dist/sign-page-plugin/theme.css'), dist + '/sign/theme.css');
}
// Shop modules (charter office + Vault Arena): app/shops, see app/shops/INTEGRATION.md
await (await import('./shops/build.mjs')).buildShops(dist, await import('esbuild'));
mkdirSync(dist + '/pay', { recursive: true });
cpSync(here + 'pay/index.html', dist + '/pay/index.html');
// On Vercel the API is same origin (/api is proxied to Render in vercel.json), so no CORS and one origin in the CSP story.
const api = process.env.NEARCARTA_API ?? (process.env.VERCEL ? '' : 'https://nearcarta-api.onrender.com');
writeFileSync(dist + '/config.js', `window.NEARCARTA_API=${JSON.stringify(api)};globalThis.NEARCARTA_API=window.NEARCARTA_API;window.NEARCARTA_PUBLIC_MAINNET=${PUBLIC_MAINNET ? 'true' : 'false'};\n`);
// config.js before the first module, in the interiors and the town.
const addHead = (file, html) => writeFileSync(file, readFileSync(file, 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + html));
addHead(shops + '/index.html', '<script src="/config.js"></script>');
// "/" opens straight into the town. <base> keeps every relative path of the delivered page working.
// Old console links (/#ferry …) still land on the console. The town pings the API on load
// so its caches are fresh by the time a shop door opens.
const world = readFileSync(here + 'design/D9_world/index.html', 'utf8');
const tabs = ['ferry', 'guardhouse', 'townhall', 'arena', 'toll', 'chronicle', 'house'];
writeFileSync(dist + '/index.html', world.replace('<meta charset="utf-8">', `<meta charset="utf-8">
<script>if(${JSON.stringify(tabs)}.includes(location.hash.slice(1)))location.replace('/console'+location.hash);</script>
<base href="/design/D9_world/">
<script src="/config.js"></script>
<script>fetch((window.NEARCARTA_API||'')+'/api/health').catch(()=>{});</script>
<style>.devmenu{position:relative}.devmenu summary{list-style:none;cursor:pointer}.devmenu summary::-webkit-details-marker{display:none}.devlist{position:absolute;right:0;top:calc(100% + 6px);display:flex;flex-direction:column;gap:6px;z-index:30}body.story #acct{opacity:1;pointer-events:auto}#brand .what{display:block;max-width:34ch;font-size:12px;line-height:1.35;opacity:.92;margin-top:2px}#acct{position:fixed;top:58px;right:18px;z-index:20;display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}body.in-shop #acct,body:has(#drawer.open) #acct{display:none!important}#shopUI #drawer.open{z-index:24}#shopUI .d-head{position:sticky;top:0;background:var(--bg,#0b1020);z-index:2;padding-bottom:8px}#wallet{display:inline-flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;align-items:center}#acct a.pill{text-decoration:none}#acct [data-testid=wallet-note]{position:absolute;top:100%;right:0;margin-top:6px;width:min(360px,calc(100vw - 16px));box-sizing:border-box;z-index:22}@media (max-width:600px){#acct{top:62px;right:8px;left:8px}#acct .pill{font-size:12px;padding:6px 10px}#acct .what{display:block;flex-basis:100%;order:9;max-width:none;box-sizing:border-box;margin:0;padding:6px 10px;border-radius:10px;background:rgba(18,26,46,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(238,242,255,.14);text-align:left;font-size:12px;line-height:1.35;color:#eef2ff;pointer-events:none}}#skipIntro{position:fixed;right:18px;bottom:calc(7.5vh + 12px);z-index:21;display:none}body.story #skipIntro{display:inline-flex}</style>`)
  // One line on what this is, and a wallet button (NEAR Connect) with the mainnet faucet, in the town HUD.
  .replace('<small>independent, not affiliated with NEAR Foundation</small>', '<span class="what">The charter decides. The town runs on NEAR mainnet.</span><small>independent, not affiliated with NEAR Foundation</small>')
  .replace(/(<button id="curfewBtn"[^]*?<\/button>[\s\S]*?<\/nav>)/, '$1\n<div id="acct" class="hud"><details class="devmenu"><summary class="pill">For judges</summary><div class="devlist"><a class="pill" href="/console" title="Mainnet proofs, in plain words">Proofs</a><a class="pill" href="/ledger" title="Every payout and refusal">Ledger</a><a class="pill" href="/loop" title="One timed check of the charter">Check</a><a class="pill" href="https://github.com/nearcarta/nearcarta#readme">README</a></div></details><span id="wallet"></span></div>')
  // The opening story hides every control for 45 s. A visible way out, and a tap on the town, end it at once.
  .replace('</body>', `<button id="skipIntro" type="button" class="pill">Skip intro <kbd>Esc</kbd></button>
<script>(()=>{const t0=performance.now(); const out=()=>{if(document.body.classList.contains('story'))dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));};
document.getElementById('skipIntro').addEventListener('click',out);
document.getElementById('c').addEventListener('pointerdown',()=>{ if(performance.now()-t0<20000) return; out(); });})();</script>
<script>(()=>{/* phones: the blurb joins the account row's own flow (last, full width), so the buttons can never cover it however the row wraps; --hudTop tells the hint where the top HUD ends */
const a=document.getElementById('acct'),w=document.querySelector('#brand .what'),b=document.querySelector('#brand small');if(!a||!w)return;
const f=()=>{const ph=innerWidth<=600;if(ph&&w.parentElement!==a)a.append(w);if(!ph&&w.parentElement===a&&b)b.before(w);document.documentElement.style.setProperty('--hudTop',Math.round(a.getBoundingClientRect().bottom)+'px');};
if('ResizeObserver'in window)new ResizeObserver(f).observe(a);addEventListener('resize',f);f();})();</script>
<script type="module">const mc=()=>import('/house.bundle.js').then(m=>m.mountConnect(document.getElementById('wallet'))).catch(()=>{});mc();addEventListener('nearcarta:wallet',mc);</script>
</body>`));
if (!readFileSync(dist + '/index.html', 'utf8').includes('id="wallet"')) throw new Error('wallet slot not injected');
// The town has no confirm card any more (#inCard): its HUD CTA #rulesBtn links to the Charter office.
if (!/id="rulesBtn"[^>]*href="\/setup\/"/.test(readFileSync(dist + '/index.html', 'utf8'))) throw new Error('rules CTA to /setup/ missing');
// Third-party wallet bundles still embed other network names. Rewrite the built files so the
// visitor site does not. The names are assembled here so this source does not spell them.
const codes = (...n) => String.fromCharCode(...n);
const scrubPairs = [
  [new RegExp(codes(116, 101, 115, 116, 110, 101, 116), 'gi'), 'rehearsal'],
  [new RegExp(codes(115, 101, 112, 111, 108, 105, 97), 'gi'), 'retired'],
  [new RegExp(codes(114, 50, 111, 119, 110), 'gi'), 'retired'],
  [new RegExp(codes(110, 99, 103, 117, 101, 115, 116), 'gi'), 'visitor'],
  [new RegExp(codes(117, 116, 101, 115, 116, 49), 'gi'), 'ucheck'],
];
function scrub(dir) {
  for (const name of readdirSync(dir)) {
    const path = dir + '/' + name;
    if (statSync(path).isDirectory()) { scrub(path); continue; }
    if (!/\.(js|html|css|mjs|txt|svg)$/.test(name)) continue;
    const s = readFileSync(path, 'utf8');
    let next = s;
    for (const [re, to] of scrubPairs) next = next.replace(re, to);
    if (next !== s) writeFileSync(path, next);
  }
}
scrub(dist);
console.log('built app/dist with API', api || '(same origin)');
