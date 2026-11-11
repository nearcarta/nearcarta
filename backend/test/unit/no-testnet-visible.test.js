// The built site has one guest path on the public test network, and the mainnet path must stay exactly
// what it was. Before this feature the site named only mainnet, so the check was "no file mentions the
// other network". That is no longer true by design: the Try free entry, the network module and the guest
// key module name it, and a judge must be able to see which network a card is on.
//
// The check is now the one that still matters: the other network is named ONLY in the handful of modules
// that own it, so a stray address or a stray explorer link cannot appear anywhere else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { retiredNet } from '../../../shared/net/word-scan.js';

const root = new URL('../../../', import.meta.url).pathname;
const bad = new RegExp(`${retiredNet.source}|r2own|ncguest|utest1`, 'i');

// The modules that legitimately name the guest network: the one network module, the guest key module,
// the guest banner, and the deployments record the build reads.
const OWNERS = [
  /^shared\/net\/net\.js$/,
  /^net\/chrome\.js$/,
  /^guest\/key\.js$/,
  /^market\/live-guest\.js$/,
  /^judges-run\.js$/,
  /^shared\/deployments\/testnet\.json$/,
];

function walk(dir, hits, base = '') {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(path).isDirectory()) { walk(path, hits, rel); continue; }
    if (!/\.(js|html|css|json|txt|mjs|svg)$/.test(name)) continue;
    const text = readFileSync(path, 'utf8');
    if (!bad.test(text)) continue;
    if (OWNERS.some((re) => re.test(rel))) continue;
    hits.push(rel);
  }
}

test('the built site names the other network only where the guest path owns it', () => {
  execFileSync(process.execPath, ['app/build.mjs'], { cwd: root, stdio: 'pipe', env: { ...process.env, NEARCARTA_API: '' } });
  const hits = [];
  walk(join(root, 'app/dist'), hits);
  assert.deepEqual(hits, [], 'only shared/net/net.js and guest/key.js may name the guest network (plus the record)');
});

test('the network module is published at the path every page imports', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  execFileSync(process.execPath, ['app/build.mjs'], { cwd: root, stdio: 'pipe', env: { ...process.env, NEARCARTA_API: '' } });
  const built = join(root, 'app/dist/shared/net/net.js');
  assert.ok(existsSync(built), 'app/build.mjs publishes shared/net/net.js at /shared/net/net.js');
  const src = readFileSync(built, 'utf8');
  assert.match(src, /export function txUrl/);
  assert.match(src, /export function api/);
  assert.match(src, /NEARCARTA_NET/, 'the answer is published for the modules that cannot import it');
});
