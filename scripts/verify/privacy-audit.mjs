// Live privacy leak audit of the site and the API. Read-only: every GET route (with real ids from the
// listing routes and with bad ids for the error paths), every POST route with invalid bodies only, unknown
// routes, every text file of the built site (app/dist file list, fetched live), a .map probe for every
// .js/.css, all response headers, and the console + /api traffic of each page in a headless browser.
// Then scans it all for value leaks (UFVK/viewing keys, salts, Mist Bank amounts, private keys, seed
// phrases, IPs, emails, retired proof values) and, if .secrets/ is present, for any secret-only value
// (a string under .secrets/ that appears in no tracked file). Secret values are never printed or written.
//   node scripts/verify/privacy-audit.mjs   -> judges/proofs/privacy-audit.json
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const SITE = process.env.SITE || 'https://nearcarta.vercel.app', API = process.env.API || 'https://nearcarta-api.onrender.com';
const SECRETS = process.env.SECRETS_DIR || [join(ROOT, '.secrets'), join(ROOT, '../.secrets'), join(ROOT, '../../.secrets')].find(existsSync) || join(ROOT, '.secrets');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const corpus = []; // { where, url, method, status, text }
const reqLog = [];
const PACE = Number(process.env.PACE_MS || 900);

async function hit(url, { method = 'GET', body, ctype = 'application/json', where = 'api' } = {}) {
  await sleep(where.startsWith('site') && where !== 'site-api' ? 60 : PACE);
  let r, text = '';
  try {
    r = await fetch(url, { method, redirect: 'manual', headers: body !== undefined ? { 'content-type': ctype } : {}, body });
    text = await r.text();
  } catch (e) { reqLog.push({ url, method, status: 'ERR ' + e.message }); return null; }
  const headers = [...r.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
  corpus.push({ where, url, method, status: r.status, text: headers + '\n\n' + text });
  reqLog.push({ url: url.replace(SITE, '{site}').replace(API, '{api}'), method, status: r.status, bytes: text.length });
  return { status: r.status, text, headers: r.headers };
}
const j = s => { try { return JSON.parse(s); } catch { return null; } };

// ---- 1. API routes, on the API host and through the site's /api rewrite ----
async function apiPass(base, tag) {
  const g = async p => { const r = await hit(base + p, { where: tag }); return r && j(r.text); };
  const dep = await g('/api/deployments') || {};
  await g('/api/health'); await g('/api/whoami');
  await g('/api/ferry/tokens'); await g('/api/ferry/tidepool');
  const tp = await g('/api/ferry/tidepool');
  await g('/api/ferry/status'); await g('/api/ferry/status?env=MAINNET'); await g('/api/ferry/status?depositAddress=nope');
  if (tp?.deposit_address || tp?.depositAddress) await g('/api/ferry/status?depositAddress=' + encodeURIComponent(tp.deposit_address || tp.depositAddress));
  await g('/api/ferry/zcash/not-an-address'); await g('/api/ferry/zcash/utest1' + 'q'.repeat(60));
  await g('/api/guardhouse'); await g('/api/guardhouse/denylist');
  await g('/api/guardhouse/check/attacker.r10own-19371.near'); await g('/api/guardhouse/check/!!bad');
  await g('/api/guardhouse/action/1'); await g('/api/guardhouse/action/999999999'); await g('/api/guardhouse/action/x');
  const house = await g('/api/house');
  await g('/api/house/deed'); await g('/api/house/deed/mint'); await g('/api/house/deed/mint?house=!!');
  await g('/api/house/deed/' + (house?.owner || 'nobody.near')); await g('/api/house/deed/!!bad');
  const mb = await g('/api/mistbank') || {};
  await g('/api/mistbank/verify'); await g('/api/mistbank/verify?commitment=00');
  await g('/api/mistbank/send'); await g('/api/mistbank/send/does-not-exist'); await g('/api/mistbank/send/' + '0'.repeat(64));
  const ztx = JSON.stringify(mb).match(/\b[0-9a-f]{64}\b/)?.[0];
  if (ztx) await g('/api/mistbank/street/' + ztx);
  await g('/api/mistbank/street/' + 'f'.repeat(64)); await g('/api/mistbank/street/bad');
  await g('/api/townhall'); await g('/api/arena'); await g('/api/arena/attempts'); await g('/api/arena/attempts?limit=5&deep=1');
  await g('/api/toll'); const gate = await g('/api/toll/gate');
  const nonce = JSON.stringify(gate || {}).match(/"nonce"\s*:\s*"?(\d+)/)?.[1];
  if (nonce) await g('/api/toll/gate/' + nonce);
  await g('/api/toll/gate/999999999'); await g('/api/toll/gate/bad');
  const charter = process.env.AUDIT_CHARTER || 'gd-mvst67ib.nccharters-53681.near';
  await g('/api/chronicle/' + charter); await g('/api/chronicle/!!bad');
  await g(`/api/charter/${charter}/reputation`); await g(`/api/charter/${charter}/rules/0`); await g('/api/charter/!!/rules/x');
  await g('/api/tx/' + (process.env.AUDIT_TX || '4Y2P7YGDVVhcgkusbbbL5JdkdnSKAPthn4xuwHMgtzvU')); await g('/api/tx/bad');
  await g('/api/ai/attestation'); await g('/api/ai/tee/models'); await g('/api/ai/tee'); await g('/api/ai/tee?nonce=zz'); await g('/api/ai/tee?model=nope');
  await g('/api/vault/config'); await g('/api/vault/charters'); await g('/api/vault/charter/' + charter); await g('/api/vault/charter/!!bad');
  await g('/api/vault/tasks'); await g('/api/vault/tasks?charter=' + charter); await g('/api/agent/budget');
  await g('/api/vault/score/' + charter); await g('/api/vault/score/!!bad'); await g('/api/vault/leaderboard'); await g('/api/vault/runner');
  await g('/api/does-not-exist'); await g('/api/'); await g('/api/../.env'); await g('/api/%2e%2e/.secrets');
  // POST routes: invalid bodies only (error paths; nothing is queued, signed or sent).
  const P = (p, body, ctype) => hit(base + p, { method: 'POST', body, ctype, where: tag });
  for (const p of ['/api/ferry/quote', '/api/mistbank/verify', '/api/mistbank/send/prepare', '/api/mistbank/send', '/api/mistbank/worker/sync',
    '/api/toll/gate/999999999/broadcast', '/api/ai/prove', '/api/vault/attack', '/api/vault/task', '/api/vault/ask/plan', '/api/vault/ask', '/api/vault/record']) {
    await P(p, '{"x":'); await P(p, '[]');
  }
  await P('/api/vault/attack', '{"attack":"__audit_invalid__"}'); await P('/api/vault/task', '{"task":"__audit_invalid__"}');
  await P('/api/vault/ask', '{"text":""}'); await P('/api/vault/ask/plan', '{"text":"","charter":"!!"}');
  await P('/api/mistbank/send/prepare', '{"ua":"not-an-address"}'); await P('/api/mistbank/send', '{"ua":"not-an-address"}');
  await P('/api/ferry/quote', '{"amount":"-1"}'); await P('/api/vault/record', '{"tx":"bad","charter":"bad"}');
  await P('/api/mistbank/worker/sync', '{"records":[]}');
  await hit(base + '/api/health', { method: 'OPTIONS', where: tag }); await hit(base + '/api/health', { method: 'DELETE', where: tag });
  return dep;
}

// ---- 2. Site files: every text file of app/dist, fetched live, plus a .map probe per .js/.css ----
const TEXT = /\.(html|js|mjs|css|json|txt|svg|md|webmanifest|xml|map)$/i;
function distFiles(dir = join(ROOT, 'app/dist'), out = []) {
  for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? distFiles(p, out) : out.push('/' + relative(join(ROOT, 'app/dist'), p)); }
  return out;
}
async function sitePass() {
  if (!existsSync(join(ROOT, 'app/dist'))) execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
  const files = distFiles(), text = files.filter(f => TEXT.test(f)), maps = [];
  const pages = ['/', '/console', '/judges.html', '/shops/vault/', '/shops/hall/', '/design/D8_shops/', '/design/D9_world/', '/robots.txt', '/.env', '/.secrets/zcash-wallet.json', '/.git/config', '/package.json'];
  for (const p of pages) await hit(SITE + p, { where: 'site' });
  for (const f of text) await hit(SITE + f, { where: 'site' });
  for (const f of files.filter(f => /\.(m?js|css)$/.test(f))) {
    const r = await hit(SITE + f + '.map', { where: 'site-map' });
    if (r && r.status === 200 && /"mappings"/.test(r.text)) maps.push(f + '.map');
  }
  const refs = corpus.filter(c => c.where === 'site').flatMap(c => [...c.text.matchAll(/sourceMappingURL=([^\s*'"]+)/g)].map(m => m[1])).filter(u => !u.startsWith('data:'));
  return { files: files.length, text_files: text.length, map_probes: files.filter(f => /\.(m?js|css)$/.test(f)).length, maps_served: maps, sourceMappingURL_refs: [...new Set(refs)] };
}

// ---- 3. Browser: console output + every /api response the pages fetch ----
async function browserPass() {
  let chromium; try { ({ chromium } = await import('@playwright/test')); } catch { return { skipped: 'no playwright' }; }
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const out = { pages: [], console_lines: 0 };
  const urls = ['/', '/console', '/judges.html', '/shops/vault/', '/shops/hall/', '/design/D9_world/',
    ...['bank', 'guard', 'ferry', 'toll', 'hall', 'arena', 'house'].map(s => `/design/D8_shops/?shop=${s}&rm`)];
  for (const u of urls) {
    const p = await b.newPage(); const lines = [];
    p.on('console', m => lines.push(`[${m.type()}] ${m.text()}`)); p.on('pageerror', e => lines.push(`[pageerror] ${e.message}`));
    p.on('response', async r => { if (/\/api\//.test(r.url())) { try { corpus.push({ where: 'browser-api', url: r.url(), method: r.request().method(), status: r.status(), text: [...Object.entries(r.headers())].map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\n' + await r.text() }); } catch { } } });
    try { await p.goto(SITE + u, { waitUntil: 'load', timeout: 90_000 }); await p.waitForTimeout(12_000); } catch (e) { lines.push('[nav] ' + e.message); }
    corpus.push({ where: 'console', url: SITE + u, method: 'CONSOLE', status: 0, text: lines.join('\n') });
    out.pages.push({ url: u, console_lines: lines.length, errors: lines.filter(l => /^\[(error|pageerror)\]/.test(l)).length }); out.console_lines += lines.length;
    await p.close();
  }
  await b.close(); return out;
}

// ---- 4. Scan ----
const BIP39 = (() => { try { return new Set(JSON.parse(readFileSync(join(ROOT, 'node_modules/bip39/src/wordlists/english.json')))); } catch { return null; } })();
const RULES = [
  ['ufvk_or_viewing_key_value', /\b(uview(test)?1[02-9ac-hj-np-z]{40,}|zxview[a-z]*1[02-9ac-hj-np-z]{40,}|secret-extended-key[a-z-]*1[02-9ac-hj-np-z]{40,})/],
  ['ufvk_field_with_value', /"(ufvk|uview|viewing_?key|fvk|ivk)"\s*:\s*"[^"]{8,}"/i],
  ['salt_field_with_value', /"salt"\s*:\s*"[^"]{4,}"/i],
  // fee_zat and value_balance_zat are the public network fee and pool balance of the shielded tx (the same for
  // every fixed-note send, and printed by any explorer); they say nothing about the amount.
  ['zats_field', /"([a-z_]*zats?[a-z_]*)"\s*:\s*"?\d/i, null, m => /^(fee_zat|value_balance_zat)$/i.test(m[1])],
  ['zats_word_in_api', /\bzats?\b/i, c => c.where !== 'site' && c.where !== 'site-map'],
  ['mistbank_amount_field', /"(amount|value|amount_zec|value_zat|valueZat|zec)"\s*:\s*"?\d[\d.]*"?\s*[,}\]]/i, c => /mistbank/.test(c.url)],
  // Same length as a 64-byte secret key: signatures and secp256k1 public keys. Those are skipped by their field name;
  // every real key in .secrets/ is also matched exactly by secret_only_value below.
  ['near_private_key', /\b(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{80,}/, null, (m, text) => /"(signature|derived_key|public_key|publicKey|pk)"\s*:\s*"$/.test(text.slice(Math.max(0, m.index - 40), m.index))],
  ['private_key_field', /"(private_?key|secret_?key|secretKey|privateKey|sk|seed|seed_?phrase|mnemonic|spending_?key)"\s*:\s*"[^"]{8,}"/i],
  ['pem_private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  // SVG path data ("7.5.171.27") and 0.0.0.0-style literals in a vendored parser are numbers, not addresses.
  ['ipv4', /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/, c => !/\.svg(\?|$)/.test(c.url), m => /^0\./.test(m[0])],
  ['ipv6_client', /\b(x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|x-vercel-forwarded-for|"ip")\s*[:=]/i],
  // Author lines in the license headers of vendored libraries (three.js addons, meshopt, GSAP) are not ours.
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, c => !/\/vendor\//.test(c.url)],
  ['retired_d0b52067', /d0b52067/i],
  ['retired_5HG5SPJ5', /5HG5SPJ5/],
];
function seedHits(text) {
  if (!BIP39) return 0; let n = 0;
  for (const m of text.matchAll(/(?:\b[a-z]{3,8}\b[ ,]+){11,23}\b[a-z]{3,8}\b/g)) { const w = m[0].split(/[ ,]+/); if (w.length >= 12 && w.every(x => BIP39.has(x))) n++; }
  return n;
}
const SECRET_NAME = /priv|secret|seed|mnemonic|ufvk|uview|viewing|fvk|ivk|salt|spend|token|pass|api_?key|^sk$|^key$|_key$|^KEY|_KEY|wif|xprv/i;
function secretValues() {
  if (!existsSync(SECRETS)) return [];
  const vals = new Set();
  const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else {
    const s = readFileSync(p, 'utf8'); const o = j(s);
    // Only secret-bearing values: JSON fields named like a key, salt, seed, token or viewing key, VAR=value lines whose
    // name says so, and bare lines of non-JSON files. Account ids, public keys and tx hashes stored beside them are public.
    const leaf = (v, k = '') => { if (typeof v === 'string') { if (SECRET_NAME.test(k) && !/public/i.test(k)) vals.add(v); } else if (v && typeof v === 'object') Object.entries(v).forEach(([kk, vv]) => leaf(vv, Array.isArray(v) ? k : kk)); };
    if (o) leaf(o); else s.split(/\r?\n/).forEach(l => { const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*['"]?(.+?)['"]?\s*$/); if (!m) vals.add(l.trim()); else if (SECRET_NAME.test(m[1])) vals.add(m[2]); });
  } } };
  walk(SECRETS);
  for (const [k, v] of Object.entries(process.env)) if (/KEY|TOKEN|SECRET|PASS|SEED|MNEMONIC|UFVK/i.test(k) && v) vals.add(v.trim());
  const cand = [...vals].filter(v => v.length >= 16 && v.length <= 4096 && /^[\x20-\x7e]+$/.test(v) && !/^(https?:\/\/|\/)/.test(v) && !/^[a-z0-9._-]+\.near$/.test(v));
  // Values that also appear in a tracked file are public (account ids, public keys): drop them. The pattern file
  // lives in a private temp dir and is removed at once.
  let tracked = ''; const tmp = mkdtempSync(join(tmpdir(), 'pa-')), pf = join(tmp, 'p');
  try { writeFileSync(pf, cand.join('\n'), { mode: 0o600 }); tracked = execSync(`git grep -I -h -o -F -f ${pf} -- .`, { cwd: ROOT, maxBuffer: 1 << 28 }).toString(); }
  catch (e) { if (e.status !== 1) throw e; } finally { rmSync(tmp, { recursive: true, force: true }); }
  const pub = new Set(tracked.split('\n'));
  return cand.filter(v => !pub.has(v) && ![...pub].some(p => p.includes(v)));
}
function scan() {
  const res = Object.fromEntries(RULES.map(([n]) => [n, []])), skipped = {}; res.seed_phrase = []; res.secret_only_value = [];
  const secrets = secretValues();
  for (const c of corpus) {
    for (const [n, re, only, skip] of RULES) { if (only && !only(c)) continue; const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (const m of c.text.matchAll(g)) if (skip && skip(m, c.text, c)) skipped[n] = (skipped[n] || 0) + 1; else res[n].push({ where: c.where, url: c.url.replace(SITE, '{site}').replace(API, '{api}'), status: c.status, match: m[0].slice(0, 80), context: c.text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40).replace(/\s+/g, ' ') }); }
    const s = seedHits(c.text); if (s) res.seed_phrase.push({ where: c.where, url: c.url, count: s });
    const k = secrets.filter(v => c.text.includes(v)).length; if (k) res.secret_only_value.push({ where: c.where, url: c.url.replace(SITE, '{site}').replace(API, '{api}'), count: k });
  }
  return { res, skipped, secret_values_checked: secrets.length };
}

const t0 = new Date();
// CORPUS=/tmp/x.json keeps what was fetched (public responses only) so the scan can be re-run with SCAN_ONLY=1.
let dep, site, browser;
if (process.env.SCAN_ONLY) { const k = JSON.parse(readFileSync(process.env.CORPUS, 'utf8')); corpus.push(...k.corpus); reqLog.push(...k.reqLog); ({ dep, site, browser } = k); }
else {
  dep = await apiPass(API, 'api'); await apiPass(SITE, 'site-api');
  site = await sitePass();
  browser = process.env.NO_BROWSER ? { skipped: 'NO_BROWSER' } : await browserPass();
  if (process.env.CORPUS) writeFileSync(process.env.CORPUS, JSON.stringify({ corpus, reqLog, dep, site, browser }));
}
const { res, skipped, secret_values_checked } = scan();
writeFileSync('/tmp/privacy-audit-raw.json', JSON.stringify({ res }, null, 1));
const counts = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.length]));
const out = { at: t0.toISOString(), finished: new Date().toISOString(), site: SITE, api: API, git: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(),
  live_api_commit: dep.commit || dep.git || null, requests: reqLog.length, corpus_items: corpus.length, corpus_bytes: corpus.reduce((a, c) => a + c.text.length, 0),
  site, browser, secret_values_checked, hits: counts, not_leaks_skipped_by_rule: skipped, total_hits: Object.values(counts).reduce((a, b) => a + b, 0),
  statuses: reqLog.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}), requests_list: reqLog };
writeFileSync(process.env.OUT || join(ROOT, 'judges/proofs/privacy-audit.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ total_hits: out.total_hits, hits: counts, requests: out.requests, secret_values_checked, maps: site.maps_served, refs: site.sourceMappingURL_refs }));
