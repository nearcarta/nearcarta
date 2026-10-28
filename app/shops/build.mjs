// Builds the self-contained shop modules into app/dist/shops. Called from app/build.mjs.
import { cpSync, mkdirSync } from 'node:fs';
const here = new URL('.', import.meta.url).pathname;
export async function buildShops(dist, esbuild) {
  mkdirSync(dist + '/shops/vault', { recursive: true });
  for (const f of ['index.html', 'vault.css']) cpSync(here + 'vault/' + f, dist + '/shops/vault/' + f);
  await esbuild.build({ entryPoints: [here + 'vault/main.js'], bundle: true, format: 'esm', minify: true, target: 'es2022', outfile: dist + '/shops/vault/vault.bundle.js',
    define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' });
}
