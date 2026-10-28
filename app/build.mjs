// Builds app/dist. "/" is the town (design/D9_world, its 2D fallback included); each shop door opens the
// shop interiors (design/D8_shops). The plain console moved to /console.html; /judges.html stays.
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
const here = new URL('.', import.meta.url).pathname;
const dist = here + 'dist';
rmSync(dist, { recursive: true, force: true }); mkdirSync(dist);
cpSync(here + 'src', dist, { recursive: true });
cpSync(here + 'design', dist + '/design', { recursive: true });
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
// Your House: NEAR Wallet Selector bundled into one ES module (the only part of the console that asks a wallet to sign).
await (await import('esbuild')).build({ entryPoints: [here + 'house/house.js'], bundle: true, format: 'esm', minify: true, target: 'es2022',
  outfile: dist + '/house.bundle.js', define: { 'process.env.NODE_ENV': '"production"', __WC_ID__: JSON.stringify(process.env.VITE_WC_PROJECT_ID || '') }, external: ['/wc.bundle.js'], logLevel: 'warning' });
// WalletConnect client, fetched only when someone picks a WalletConnect wallet. The project id is a public client id.
await (await import('esbuild')).build({ entryPoints: [here + 'house/wc.js'], bundle: true, format: 'esm', minify: true, target: 'es2022',
  outfile: dist + '/wc.bundle.js', define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' }, logLevel: 'warning' });
// Shop apps (design/D8_shops/js/apps.js): the site wallet layer and signer, bundled from source so they never drift.
await (await import('esbuild')).build({ entryPoints: [here + 'design/D8_shops/js/wallet/entry.js'], bundle: true, format: 'esm', minify: true, target: 'es2022',
  outfile: shops + '/js/wallet.bundle.js', define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' }, logLevel: 'warning' });
rmSync(shops + '/js/wallet', { recursive: true, force: true });
// Shop modules (charter office + Vault Arena): app/shops, see app/shops/INTEGRATION.md
await (await import('./shops/build.mjs')).buildShops(dist, await import('esbuild'));
// On Vercel the API is same origin (/api is proxied to Render in vercel.json), so no CORS and one origin in the CSP story.
const api = process.env.NEARCARTA_API ?? (process.env.VERCEL ? '' : 'https://nearcarta-api.onrender.com');
writeFileSync(dist + '/config.js', `window.NEARCARTA_API=${JSON.stringify(api)};globalThis.NEARCARTA_API=window.NEARCARTA_API;\n`);
// config.js before the first module, in the interiors and the town.
const addHead = (file, html) => writeFileSync(file, readFileSync(file, 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + html));
addHead(shops + '/index.html', '<script src="/config.js"></script>');
// "/" opens straight into the town. <base> keeps every relative path of the delivered page working.
// Old console links (/#ferry …) still land on the console. The free API host sleeps when idle, so the
// town wakes it on load; by the time a shop door opens, its live reads are quick.
const world = readFileSync(here + 'design/D9_world/index.html', 'utf8');
const tabs = ['ferry', 'guardhouse', 'townhall', 'arena', 'toll', 'chronicle', 'house'];
writeFileSync(dist + '/index.html', world.replace('<meta charset="utf-8">', `<meta charset="utf-8">
<script>if(${JSON.stringify(tabs)}.includes(location.hash.slice(1)))location.replace('/console'+location.hash);</script>
<base href="/design/D9_world/">
<script src="/config.js"></script>
<script>fetch((window.NEARCARTA_API||'')+'/api/health').catch(()=>{});</script>
<style>#inCard a[hidden]{display:none}body.story #acct{opacity:1;pointer-events:auto}#brand .what{display:block;max-width:34ch;font-size:12px;line-height:1.35;opacity:.92;margin-top:2px}#acct{position:fixed;top:58px;right:18px;z-index:20;display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}#wallet{display:inline-flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;align-items:center}#acct a.pill{text-decoration:none}#acct [data-testid=wallet-note]{position:absolute;top:100%;right:0;margin-top:6px;width:min(360px,calc(100vw - 16px));box-sizing:border-box;z-index:22}@media (max-width:600px){#acct{top:62px;right:8px;left:8px}#acct .pill{font-size:12px;padding:6px 10px}#brand .what{position:fixed;top:104px;left:10px;right:64px;max-width:none;font-size:11.5px;text-shadow:0 1px 3px #0009}}#skipIntro{position:fixed;right:18px;bottom:calc(7.5vh + 12px);z-index:21;display:none}body.story #skipIntro{display:inline-flex}</style>`)
  // One line on what this is, and a wallet button (NEAR Connect) with the testnet faucet, in the town HUD.
  .replace('<small>independent, not affiliated with NEAR Foundation</small>', '<span class="what">A town where an AI agent spends only what its owner\'s on-chain charter allows. NEAR testnet, no real money.</span><small>independent, not affiliated with NEAR Foundation</small>')
  .replace(/(<button id="curfewBtn"[^]*?<\/button>\s*<\/nav>)/, '$1\n<div id="acct" class="hud"><a class="pill" href="/console" title="Every shop as a plain page">Console</a><span id="wallet"></span></div>')
  // The opening story hides every control for 45 s. A visible way out, and a tap on the town, end it at once.
  .replace('</body>', `<button id="skipIntro" type="button" class="pill">Skip intro <kbd>Esc</kbd></button>
<script>(()=>{const out=()=>{if(document.body.classList.contains('story'))dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));};
document.getElementById('skipIntro').addEventListener('click',out);document.getElementById('c').addEventListener('pointerdown',out);})();</script>
<script>(()=>{const ic=document.getElementById('inCard');if(!ic)return;const v=document.createElement('a');v.className='pill go';v.href='/shops/vault/';v.dataset.testid='vault-link';v.textContent='Charter office & Vault Arena';v.hidden=true;ic.querySelector('a.go').after(v);
const sync=()=>{const h=!/[?&]shop=(guard|arena)($|&)/.test(ic.querySelector('a.go').href||'');if(v.hidden!==h)v.hidden=h;};new MutationObserver(sync).observe(ic,{attributes:true,attributeFilter:['hidden']});new MutationObserver(sync).observe(ic.querySelector('a.go'),{attributes:true,attributeFilter:['href']});sync();})();</script>
<script type="module">import('/house.bundle.js').then(m=>m.mountConnect(document.getElementById('wallet'))).catch(()=>{});</script>
</body>`));
if (!readFileSync(dist + '/index.html', 'utf8').includes('id="wallet"')) throw new Error('wallet slot not injected');
if (!readFileSync(dist + '/index.html', 'utf8').includes("v.href='/shops/vault/'")) throw new Error('vault link not injected');
console.log('built app/dist with API', api || '(same origin)');
