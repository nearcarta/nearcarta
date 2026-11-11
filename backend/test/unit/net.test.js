// shared/net/net.js is the only place that knows which network a page is on. Every explorer link,
// account id and API base goes through it, so a missed literal cannot show a mainnet link on testnet.
// These tests pin the values on both networks and fail when a new raw literal appears in a page.
// Docs: https://docs.near.org/api/rpc/providers · https://api-testnet.nearblocks.io/api-docs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** Load net.js with a chosen network. The module reads localStorage and location once, at load. */
async function load(search = '', saved = '') {
  const store = new Map();
  if (saved) store.set('nearcarta.net', saved);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.location = { search, href: `https://nearcarta.vercel.app/${search}` };
  // A fresh module instance per call: the network is decided at module load.
  return import(`../../../shared/net/net.js?net=${encodeURIComponent(search + saved)}&t=${Math.random()}`);
}

test('net: the explorer, the account suffix and the API base are right on both networks', async () => {
  const main = await load('');
  assert.equal(main.NET, 'mainnet');
  assert.equal(main.txUrl('abc'), 'https://nearblocks.io/txns/abc');
  assert.equal(main.addrUrl('alice.near'), 'https://nearblocks.io/address/alice.near');
  assert.equal(main.api('/api/health'), '/api/health');
  assert.equal(main.cfg.mpc, 'v1.signer');
  assert.equal(main.cfg.base.chainId, 8453);
  assert.equal(main.acct('arena'), 'arena.nearcarta.near');

  const test1 = await load('?net=testnet');
  assert.equal(test1.NET, 'testnet');
  assert.equal(test1.txUrl('abc'), 'https://testnet.nearblocks.io/txns/abc');
  assert.equal(test1.addrUrl('x.play.nearcarta.testnet'), 'https://testnet.nearblocks.io/address/x.play.nearcarta.testnet');
  assert.equal(test1.api('/api/guest/start'), '/tapi/guest/start');
  assert.equal(test1.api('/tapi/guest/start'), '/tapi/guest/start', 'an already-prefixed path is left alone');
  assert.equal(test1.cfg.mpc, 'v1.signer-prod.testnet');
  assert.equal(test1.cfg.base.chainId, 84532);
  assert.equal(test1.cfg.mpc, 'v1.signer-prod.testnet');
  assert.equal(test1.acct('arena'), 'arena.nearcarta.testnet');
  assert.equal(test1.acct('arena.nearcarta.near'), 'arena.nearcarta.near', 'a full name is not rewritten');
});

test('net: a saved choice beats the default, and a query wins over the saved one', async () => {
  assert.equal((await load('', 'testnet')).NET, 'testnet');
  assert.equal((await load('?net=mainnet', 'testnet')).NET, 'mainnet');
  assert.equal((await load('', 'nonsense')).NET, 'mainnet', 'an unknown saved value falls back to mainnet');
  assert.equal((await load('?net=base')).NET, 'mainnet', 'an unknown query value falls back to mainnet');
});

test('net: an empty hash gives an empty link, and base links follow the chain', async () => {
  const t = await load('?net=testnet');
  assert.equal(t.txUrl(''), '');
  assert.equal(t.addrUrl(''), '');
  assert.equal(t.baseTxUrl('0xabc'), 'https://sepolia.basescan.org/tx/0xabc');
  assert.equal(t.baseAddrUrl('0xAbC'), 'https://sepolia.basescan.org/address/0xAbC');
  assert.equal(t.isRecordedMainnet('https://nearblocks.io/txns/abc'), true);
  assert.equal(t.isRecordedMainnet('https://testnet.nearblocks.io/txns/abc'), false);
  assert.equal(t.networkLabel(), 'TESTNET');
});

test('net: apiFetch sends /api/... to this network and leaves anything else alone', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(url); return { ok: true }; };
  try {
    const m = await load('?net=testnet');
    await m.apiFetch('/api/guest/start', { method: 'POST' });
    await m.apiFetch('https://example.test/x');
    await m.apiFetch('/tee-public.json');
    assert.deepEqual(seen, ['/tapi/guest/start', 'https://example.test/x', '/tee-public.json']);
  } finally { globalThis.fetch = realFetch; }
});

// The lint: no page may build a link or an API call itself. The two modules that own the network are
// the only exceptions, plus the pages that only display a recorded mainnet proof and say so.
// The two modules that own the network, plus the three places that only ever show a RECORDED mainnet
// proof and say "Recorded on mainnet" next to it. A live link or a live API call is never allowed.
const ALLOW = new Set(['shared/net/net.js', 'shared/net/explorer.js', 'app/design/D8_shops/data/live.js',
  'app/design/D6_dashboards/src/data.js', 'app/design/D8_shops/js/apps.js', 'app/design/D8_shops/shops/_ui.js',
  'app/design/D8_shops/shops/tollrecords.js', 'app/design/D9_world/js/main.js', 'app/src/panels/guard-tray.js']);
const PROOF_ONLY = new Set(['app/src/judges-data.js', 'app/src/llms.txt']);
// A proof-only file may name a mainnet hash link, but must not fetch the API by hand.
const API_OK = new Set(['app/design/D8_shops/data/live.js', 'app/design/D6_dashboards/src/data.js',
  'app/design/D8_shops/js/apps.js', 'app/design/D8_shops/shops/_ui.js', 'app/design/D8_shops/shops/tollrecords.js',
  'app/design/D9_world/js/main.js', 'app/src/panels/guard-tray.js']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!/node_modules|dist|shots|assets|vendor/.test(p)) walk(p, out); }
    else if (/\.(js|mjs|html|txt)$/.test(name)) out.push(p);
  }
  return out;
}

test('no page builds a nearblocks link or an /api call by hand', () => {
  const bad = [];
  for (const file of walk(join(root, 'app'))) {
    const rel = file.slice(root.length).replace(/^app\//, 'app/');
    if (ALLOW.has(rel) || PROOF_ONLY.has(rel)) continue;
    if (/\.html$/.test(rel) || /llms\.txt$/.test(rel) || /build\.mjs$/.test(rel) || /serve\.mjs$/.test(rel)) continue;
    const src = readFileSync(file, 'utf8');
    // Strip comments so a doc link or a note does not count.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
    if (!API_OK.has(rel)) for (const m of code.matchAll(/nearblocks\.io\/txns/g)) bad.push(`${rel} builds a tx link (${m[0]})`);
    // A path may be written `/api/...` when it is handed to a helper that rewrites the prefix. It may
    // NOT be concatenated into a URL and fetched directly: that is the call that skips the network.
    for (const m of code.matchAll(/\b(?:fetch|fetchFn)\(/g)) {
      const arg = argOf(code, m.index + m[0].length);
      if (!arg.includes("/api/")) continue;
      const routed = /apiPath|API_PATH|NEARCARTA_NET|\bapi\(|apiFetch\(/.test(arg);
      if (!routed) bad.push(`${rel} fetches an /api path directly: ${arg.slice(0, 80).replace(/\s+/g, ' ')}`);
    }
  }
  assert.deepEqual(bad, [], `use txUrl()/addrUrl()/api() from shared/net/net.js:\n${bad.join('\n')}`);
});

/** The text of a call's first argument, ending at its top-level comma or closing paren. */
function argOf(src, from) {
  let depth = 1, quote = null, i = from;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth === 0) break; }
    else if (ch === ',' && depth === 1) break;
    i++;
  }
  return src.slice(from, i);
}

// The Try free entry: one gold action, one outlined action, and a badge that always says which network
// the page is on. At 390px it must not overlap the Back button, the dock or All shops.
test('the town entry offers a free testnet account and a real-money sign-in', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../../../app/design/D9_world/index.html', import.meta.url), 'utf8');
  const chrome = readFileSync(new URL('../../../app/src/net/chrome.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../../app/design/D9_world/world.css', import.meta.url), 'utf8');
  // The two entries exist in the markup before any script runs, so the page always shows them.
  assert.match(html, /data-testid="try-free"/);
  assert.match(html, /data-testid="sign-in"/);
  assert.match(html, /href="\/setup\/"/, 'the real-money action is the existing sign-in');
  assert.match(html, /data-testid="net-badge"/);
  // Gold for the free action, outlined for the real-money one: the Gold rule.
  assert.match(html, /id="tryFree"[^>]*class="btn-gold"/);
  assert.match(html, /id="signIn"[^>]*class="btn-outline"/);
  assert.match(html, /Play the whole city on the NEAR test network/);
  // The badge text comes from the one module that knows the network.
  assert.match(chrome, /networkLabel\(\)/);
  assert.match(chrome, /TESTNET/);
  assert.match(chrome, /MAINNET/);
  // The sheet offers the key download and the upgrade path.
  assert.match(chrome, /Save my test key/);
  assert.match(chrome, /Play for real money/);
  // The welcome card lists the crate and one gold deed button.
  assert.match(chrome, /data-testid="welcome-card"/);
  assert.match(chrome, /data-testid="mint-deed"/);
  assert.match(chrome, /mint_deed/);
  // Practice mode is named as the floor whenever a cap refuses.
  assert.match(chrome, /Practice mode|practice mode/);
  // The row is one item in the town's own top bar, not a second fixed strip: two fixed strips at the
  // top is what overlapped at 390px. A gap keeps it clear, and the e2e test pins the real boxes.
  assert.match(css, /\.net-chrome\{[^}]*gap:10px/);
  assert.match(css, /\.net-chrome\.in-topbar\{position:static/);
  assert.match(css, /@media \(max-width:720px\)\{[\s\S]*?\.net-chrome\{[^}]*order:-1/);
  assert.match(css, /\.net-badge\.test\{[^}]*#2f9a8c/, 'the testnet pill is teal');
  assert.match(css, /\.net-badge\.main\{[^}]*#c98f4e/, 'the mainnet pill is gold');
});

// The game is the front door. A first visit lands in the playable town with the gold action in front of
// them; the cinematic is one press away, not a gate.
test('the game is the front door and the story is a press away', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../../../app/design/D9_world/index.html', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
  const chrome = readFileSync(new URL('../../../app/src/net/chrome.js', import.meta.url), 'utf8');
  const plan = readFileSync(new URL('../../../app/design/D9_world/js/intro-plan.js', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../../../app/design/D9_world/js/main.js', import.meta.url), 'utf8');
  // The first screen says it is a game, and the two real actions are there before any script runs.
  assert.match(html, /<meta name="description" content="Nearcarta is a game/);
  assert.match(html, /data-testid="try-free"/);
  assert.match(html, /data-testid="sign-in"/);
  assert.match(html, /data-testid="watch-story"/);
  // The cinematic does not start on a fresh visit; it starts when asked.
  assert.match(plan, /return p\.has\('story'\)/);
  assert.match(main, /const startStory=P\.has\('story'\)/);
  // One gold main action. `#rulesBtn` is the town's existing gold CTA (the Gold rule), so Try free is
  // gold too but the town keeps exactly one gold pill above the fold; Play for real is outlined.
  assert.match(html, /id="rulesBtn" class="hud pill go"/);
  assert.match(chrome, /class="btn-gold" data-testid="try-free"/);
  assert.match(chrome, /class="btn-outline" data-testid="sign-in"/);
  // The README opens with the game, before the engineering record.
  const gameAt = readme.indexOf('## The game');
  const whyAt = readme.indexOf('An AI agent can be talked into paying the wrong person');
  assert.ok(gameAt > 0 && gameAt < whyAt, 'the Games section is the first thing a reader sees');
  assert.match(readme.slice(gameAt, gameAt + 1200), /Play free/);
  assert.match(readme.slice(gameAt, gameAt + 1200), /Play for real/);
});
