// Builds the self-contained shop modules into app/dist/shops. Called from app/build.mjs.
import { cpSync, mkdirSync } from 'node:fs';
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
  await esbuild.build({ entryPoints: [here + 'payouts/main.js'], bundle: true, format: 'esm', minify: true, target: 'es2022', outfile: dist + '/shops/payouts/payouts.bundle.js', logLevel: 'warning' });
}
