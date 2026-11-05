// Builds the self-contained shop modules into app/dist/shops. Called from app/build.mjs.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
const here = new URL('.', import.meta.url).pathname;
export async function buildShops(dist, esbuild) {
  mkdirSync(dist + '/shops/vault', { recursive: true });
  for (const f of ['index.html', 'vault.css']) cpSync(here + 'vault/' + f, dist + '/shops/vault/' + f);
  await esbuild.build({ entryPoints: [here + 'vault/main.js'], bundle: true, format: 'esm', minify: true, target: 'es2022', outfile: dist + '/shops/vault/vault.bundle.js',
    define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', ...(await import('../build-defines.mjs')).walletDefine }, logLevel: 'warning' });
  // Town Hall proposals page: the visitor files a Sputnik DAO proposal; reuses the vault wallet layer and CSS.
  mkdirSync(dist + '/shops/hall', { recursive: true });
  for (const f of ['index.html', 'hall.css']) cpSync(here + 'hall/' + f, dist + '/shops/hall/' + f);
  await esbuild.build({ entryPoints: [here + 'hall/main.js'], bundle: true, format: 'esm', minify: true, target: 'es2022', outfile: dist + '/shops/hall/hall.bundle.js',
    define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"', ...(await import('../build-defines.mjs')).walletDefine }, logLevel: 'warning' });
  mkdirSync(dist + '/shops/payouts', { recursive: true });
  cpSync(here + 'payouts/index.html', dist + '/shops/payouts/index.html');
  cpSync(here + 'payouts/payouts.css', dist + '/shops/payouts/payouts.css');
  await esbuild.build({ entryPoints: [here + 'payouts/main.js'], bundle: true, format: 'esm', minify: true, target: 'es2022', outfile: dist + '/shops/payouts/payouts.bundle.js',
    external: ['/house.bundle.js', '/shops/hall/hall.bundle.js'], logLevel: 'warning' });
  const rooms = [
    ['ferry', 'ferry', 'Ferry'],
    ['guard', 'guard', 'Guardhouse'],
    ['guardhouse', 'guard', 'Guardhouse'],
    ['bank', 'bank', 'Mist Bank'],
    ['mist', 'bank', 'Mist Bank'],
    ['mistbank', 'bank', 'Mist Bank'],
    ['arena', 'arena', 'Vault Arena'],
    ['toll', 'toll', 'Toll Bridge'],
    ['chronicle', 'chronicle', 'Chronicle'],
    ['house', 'house', 'Your House'],
    ['townhall', 'hall', 'Town Hall'],
  ];
  for (const [dir, shop, title] of rooms) {
    mkdirSync(dist + '/shops/' + dir, { recursive: true });
    writeFileSync(dist + '/shops/' + dir + '/index.html', roomPage(shop, title));
  }
}

function roomPage(shop, title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nearcarta · ${title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/brand/chrome.css">
<link rel="stylesheet" href="/brand/brown.css">
<link rel="stylesheet" href="/console.css">
<link rel="stylesheet" href="/panels/panels.css">
<script src="/config.js"></script>
<script>
try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }); } catch (e) {}
try { if (window.caches && caches.keys) caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); }); } catch (e) {}
</script>
</head>
<body data-shop="${shop}">
<header class="shop-page">
  <p><a class="back-town" href="/" data-testid="back-town">Back to town</a></p>
  <h1>${title}</h1>
</header>
<main id="room" class="shop-page" data-testid="shop-room"></main>
<script type="module" src="/panels/boot.js"></script>
</body>
</html>
`;
}
