#!/usr/bin/env node
// Repo-vs-live check: every file, proof, account and code hash cited by the live
// /api/deployments, the live /api/vault/config, judges/VERIFY.md and README.md must
// exist on origin/main and (for accounts and code hashes) on the NEAR mainnet RPC.
// Read-only: git reads, HTTP GETs and RPC view calls. Prints every miss, exits 1 on any miss.
// Tx hashes are not checked here; `npm run verify` checks those.
// Usage: node scripts/check-cited.mjs [--ref origin/main] [--api https://nearcarta.vercel.app]
//        [--json judges/proofs/cited-check.json] [--no-fetch]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { posix } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const REF = arg('--ref', 'origin/main');
const API = arg('--api', 'https://nearcarta.vercel.app').replace(/\/$/, '');
const JSON_OUT = arg('--json', null);
const RPCS = ['https://rpc.mainnet.fastnear.com', 'https://free.rpc.fastnear.com', 'https://rpc.mainnet.near.org'];
const RPCS_MAIN = ['https://rpc.mainnet.fastnear.com', 'https://rpc.mainnet.near.org'];
const DOCS = ['judges/VERIFY.md', 'README.md'];
// accounts the docs cite on purpose as never created (attack payees); a miss if they ever exist
const MUST_NOT_EXIST = new Map([['r6vamvr9brhx-b0b.near', 'allowlist look-alike payee in the Arena scam set']]);

const git = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
if (!process.argv.includes('--no-fetch')) { try { git('fetch', '-q', 'origin'); } catch { console.error('warn: git fetch failed, using the local ' + REF); } }
const head = git('rev-parse', '--short', REF).toString().trim();
const onRef = p => { try { git('cat-file', '-e', `${REF}:${p}`); return true; } catch { return false; } };
const show = p => git('show', `${REF}:${p}`);

// base58 (NEAR code_hash = base58(sha256(wasm)))
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = buf => { let n = BigInt('0x' + (buf.toString('hex') || '0')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of buf) { if (b) break; s = '1' + s; } return s; };
const unb58 = s => { let n = 0n; for (const c of s) n = n * 58n + BigInt(B58.indexOf(c)); let h = n.toString(16); if (h.length % 2) h = '0' + h; return h.padStart(64, '0'); };

// every wasm on the ref, with sha256 hex and base58 code hash
const artifacts = git('ls-tree', '-r', '--name-only', REF).toString().split('\n').filter(f => f.endsWith('.wasm')).map(path => {
  const d = createHash('sha256').update(show(path)).digest();
  return { path, sha256: d.toString('hex'), code_hash: b58(d) };
});

// RPC
async function rpc(method, params, urls = RPCS) {
  let last;
  for (const url of urls) for (let t = 0; t < 2; t++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j.error) { const m = JSON.stringify(j.error); if (/UNKNOWN_ACCOUNT|does not exist/i.test(m)) return { missing: true }; last = m; continue; }
      return j.result;
    } catch (e) { last = String(e); await new Promise(z => setTimeout(z, 400)); }
  }
  throw new Error(`rpc ${method} failed: ${last}`);
}
const accCache = new Map();
function account(id) {
  if (!accCache.has(id)) accCache.set(id, (async () => {
    const urls = id.endsWith('.near') ? RPCS_MAIN : RPCS;
    const a = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: id }, urls);
    if (a.missing) return null;
    const k = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: id }, urls);
    const fa = (k.keys || []).filter(x => x.access_key.permission === 'FullAccess').length;
    const code = a.global_contract_hash || (a.code_hash !== '11111111111111111111111111111111' ? a.code_hash : null);
    return { code, code_hash: a.code_hash, global: a.global_contract_hash || null, full_access_keys: fa };
  })());
  return accCache.get(id);
}

// citation collection
const cites = []; // {kind, value, where, ...extra}
const add = (kind, value, where, extra = {}) => cites.push({ kind, value, where, ...extra });
const ACC = /(?<![\w.<>/-])((?:[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?\.near)(?![\w-]|\.[a-z])/g;
const ROOTS = '(?:contracts|judges|backend|app|shared|docs|e2e|scripts|design|\\.github)';
const PATH = new RegExp(`(?<![\\w/.:@-])(${ROOTS}/[A-Za-z0-9_./-]*[A-Za-z0-9_])(/?\\.?\\{[^}\\s]+\\})?`, 'g');
const TOP = /(?<![\w/.-])((?:README|SECURITY|AGENTS)\.md|LICENSE|package\.json|render\.yaml|vercel\.json|Dockerfile)(?![\w/-])/g;
const isRepoPath = p => !/\/api\//.test(p) && !/^(?:app|docs)\.[a-z]/.test(p);
const cleanPath = p => p.replace(/\/+$/, '').replace(/\.{2,}$/, '');

function pathsIn(text, where, base = '') {
  for (const m of text.matchAll(PATH)) {
    // shell braces: judges/proofs/attack-demo.{json,log} -> both files
    const sep = m[2] ? m[2].replace(/\{.*$/, '') : '';
    const list = m[2] ? m[2].replace(/^[^{]*\{|\}$/g, '').split(',').map(x => m[1] + sep + x) : [m[1]];
    for (const raw of list) { const p = cleanPath(raw); if (isRepoPath(p)) add(/judges\/proofs\//.test(p) ? 'proof' : 'file', p, where); }
  }
  for (const m of text.matchAll(/\]\(([^)\s#]+)\)/g)) { // markdown links
    const l = m[1]; if (/^[a-z]+:|^\//.test(l) || new RegExp(`^${ROOTS}/`).test(l)) continue;
    const p = posix.normalize(posix.join(base, l)); add(/judges\/proofs\//.test(p) ? 'proof' : 'file', cleanPath(p), where);
  }
}
const accountsIn = (text, where) => { for (const m of text.matchAll(ACC)) if (!/\.(?:md|js|json)$/.test(m[1])) add('account', m[1], where); };

// 1) live JSON
const RELEASES = []; // {factory, code_hash}
async function getJson(path) {
  const r = await fetch(API + path, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}
function walkJson(o, where, parent = null) {
  if (Array.isArray(o)) { o.forEach((v, i) => walkJson(v, `${where}[${i}]`, parent)); return; }
  if (!o || typeof o !== 'object') return;
  // A planned account (the mainnet factory, until the owner deploys it) is not on chain yet.
  if (o.status === 'not_deployed') return;
  const target = o.contract || o.oath || o.charter || null;
  if (o.factory && o.code_hash) RELEASES.push({ factory: o.factory, code_hash: o.code_hash, where });
  for (const [k, v] of Object.entries(o)) {
    const w = `${where}.${k}`;
    if (typeof v === 'string') {
      if (/(^|_)(tx|txs|hash_hex|memo|url|explorer.*|rpc.*|oneclick|txid|value|base_block_hash|proof_payload_hash|foreign_address|quote_signer)$/.test(k) && !/code_hash$/.test(k)) {
        if (/url|explorer|rpc/.test(k)) continue; // links, not repo/chain citations
      }
      if (/(^|_)code_hash$/.test(k) || k === 'global_code_hash') add('code_hash', v, w, { account: (k === 'code_hash' || k === 'global_code_hash') && target && typeof target === 'string' ? target : null });
      else if (/sha256$/.test(k) && /^[0-9a-f]{64}$/.test(v)) add('sha256', v, w, { file: o[k.replace(/_?sha256$/, '_artifact')] || (k === 'wasm_sha256' ? o.wasm : null) || (k === 'code_sha256' ? null : null) });
      if (/^(url|explorer|explorer_api|zcash_explorer_api|rpc|oneclick)$/.test(k) || /^https?:/.test(v)) continue;
      pathsIn(v, w);
      if (!/^(scheme|memo|note|story|purpose|how|contains|held_by|rotated|standard|name)$/.test(k) || /\.near\b/.test(v)) accountsIn(v, w);
    } else if (typeof v === 'number' && /full_access_keys$/.test(k)) {
      const acc = k === 'factory_full_access_keys' ? o.factory : target;
      if (acc) add('fa_keys', acc, w, { expect: v });
    } else walkJson(v, w, o);
  }
}
let live = {};
for (const p of ['/api/deployments', '/api/vault/config']) {
  try { live[p] = await getJson(p); walkJson(live[p], p); }
  catch (e) { add('api', p, p, { error: String(e.message || e) }); }
}

// 2) docs on the ref
const HASH_CTX_BEFORE = /(code.?hash|global (?:code|contract)|verifier code hash)[^|;.]{0,40}$/i;
const HASH_CTX_AFTER = /^[`…. ]{0,4}(?:\([^)]*\)\s*)?=\s*`?(?:contracts\/artifacts|[\w.]+\.wasm|`?oath|`?charter|code_hash)/i;
for (const doc of DOCS) {
  if (!onRef(doc)) { add('file', doc, 'docs'); continue; }
  const text = show(doc).toString();
  text.split('\n').forEach((line, i) => {
    const where = `${doc}:${i + 1}`;
    pathsIn(line, where, posix.dirname(doc) === '.' ? '' : posix.dirname(doc));
    for (const m of line.matchAll(TOP)) add('file', m[1], where);
    accountsIn(line.replace(/`<[^`]*>`/g, ''), where);
    // base58 code hashes: full (43/44) or shortened with … ; must sit in a code-hash context
    for (const m of line.matchAll(/(?<![\w])([1-9A-HJ-NP-Za-km-z]{8,44})(…|\.\.\.)?(?![\w])/g)) {
      const tok = m[1], short = !!m[2];
      if (!short && tok.length < 43) continue;
      if (/^[0-9a-f]+$/.test(tok)) continue; // hex, handled below
      const before = line.slice(Math.max(0, m.index - 60), m.index), after = line.slice(m.index + m[0].length, m.index + m[0].length + 60);
      if (/\btxs?\b[^|]{0,25}$/i.test(before)) continue;
      if (HASH_CTX_BEFORE.test(before) || HASH_CTX_AFTER.test(after)) add('code_hash', tok, where, { prefix: short });
    }
    // sha256 hex: "sha256 <hex>" (may be shortened: a6d61146… or 852b475f…05b2)
    for (const m of line.matchAll(/sha256`?\s*`?([0-9a-f]{8,64})(?:…([0-9a-f]{2,8}))?/g)) add('sha256', m[1], where, { prefix: m[1].length < 64, suffix: m[2] || null });
  });
}

// checks
const misses = [], oks = [];
const miss = (c, why) => misses.push({ ...c, why });
const ok = c => oks.push(c);
const knownB58 = new Map(artifacts.map(a => [a.code_hash, a.path]));
const knownHex = new Map(artifacts.map(a => [a.sha256, a.path]));
const seenAcc = [...new Set(cites.filter(c => ['account', 'fa_keys'].includes(c.kind)).map(c => c.value).concat(cites.filter(c => c.account).map(c => c.account)))];
// resolve accounts with limited concurrency
const accInfo = new Map();
for (let i = 0; i < seenAcc.length; i += 6) await Promise.all(seenAcc.slice(i, i + 6).map(async id => { try { accInfo.set(id, await account(id)); } catch (e) { accInfo.set(id, { error: String(e.message) }); } }));
for (const [id, a] of accInfo) if (a && a.code) { if (!knownB58.has(a.code)) knownB58.set(a.code, `on chain: ${id}`); knownHex.set(unb58(a.code), knownHex.get(unb58(a.code)) || `on chain: ${id}`); }

const done = new Set();
for (const c of cites) {
  const key = `${c.kind}|${c.value}|${c.account || ''}|${c.expect ?? ''}|${c.file || ''}`;
  const dup = done.has(key); done.add(key);
  if (c.kind === 'api') { miss(c, `live API failed: ${c.error}`); continue; }
  if (c.kind === 'file' || c.kind === 'proof') { if (dup) continue; onRef(c.value) ? ok(c) : miss(c, `not on ${REF} (${head})`); continue; }
  if (c.kind === 'account') {
    if (dup) continue; const a = accInfo.get(c.value);
    if (MUST_NOT_EXIST.has(c.value)) { a ? miss(c, `should not exist (${MUST_NOT_EXIST.get(c.value)}) but does`) : ok(c); continue; }
    if (a?.error) miss(c, `RPC error: ${a.error}`); else if (!a) miss(c, 'account does not exist on mainnet'); else ok(c);
    continue;
  }
  if (c.kind === 'fa_keys') {
    const a = accInfo.get(c.value);
    if (!a || a.error) miss(c, 'account not readable'); else if (a.full_access_keys !== c.expect) miss(c, `cites ${c.expect} full-access keys, chain has ${a.full_access_keys}`); else ok(c);
    continue;
  }
  if (c.kind === 'code_hash') {
    const match = c.prefix ? [...knownB58.keys()].find(h => h.startsWith(c.value)) : (knownB58.has(c.value) ? c.value : null);
    if (!match) { miss(c, 'code hash matches no wasm on the ref and no cited account on chain'); continue; }
    if (c.account) {
      const a = accInfo.get(c.account);
      if (!a || a.error) { miss(c, `${c.account} not readable`); continue; }
      if (a.code !== match) { miss(c, `${c.account} runs ${a.code || 'no code'} on chain`); continue; }
    }
    const art = artifacts.find(x => x.code_hash === match);
    if (!art && !/tidepool|intents|signer|sputnik/.test(knownB58.get(match))) { miss(c, `on chain (${knownB58.get(match)}) but no wasm with this hash on ${REF}`); continue; }
    ok({ ...c, matched: art ? art.path : knownB58.get(match) });
    continue;
  }
  if (c.kind === "sha256") {
    const match = [...knownHex.keys()].find(h => (c.prefix ? h.startsWith(c.value) : h === c.value) && (!c.suffix || h.endsWith(c.suffix)));
    if (!match) {
      const near = c.suffix && [...knownHex.keys()].find(h => h.startsWith(c.value));
      miss(c, near ? `ending …${c.suffix} is wrong: ${knownHex.get(near)} sha256 ends …${near.slice(-c.suffix.length)}` : 'sha256 matches no wasm on the ref and no cited account on chain'); continue;
    }
    if (c.file) { const p = c.file.split(/\s/)[0]; const art = artifacts.find(x => x.path === p); if (art && art.sha256 !== match) { miss(c, `${p} has sha256 ${art.sha256.slice(0, 12)}…`); continue; } }
    ok({ ...c, matched: knownHex.get(match) });
  }
}
// charters under a factory account run that factory release's code
const rel = new Map(); for (const r of RELEASES) rel.set(r.factory, r.code_hash);
for (const [id, a] of accInfo) {
  if (!a || a.error) continue;
  for (const [f, h] of rel) if (id.endsWith('.' + f)) {
    const c = { kind: 'charter_code', value: id, where: `factory ${f}` };
    if (a.global !== h) miss(c, `charter of ${f} should run global ${h.slice(0, 8)}…, chain has ${a.global || a.code_hash}`); else ok(c);
  }
}

// report
const byKind = k => oks.filter(o => o.kind === k).length;
console.log(`check-cited: ref ${REF} ${head}, api ${API}, ${artifacts.length} wasm on ref, ${accInfo.size} accounts read`);
console.log(`ok: files ${byKind('file')}, proofs ${byKind('proof')}, accounts ${byKind('account')}, code hashes ${byKind('code_hash')}, sha256 ${byKind('sha256')}, key counts ${byKind('fa_keys')}, charter code ${byKind('charter_code')}`);
const uniq = []; const s = new Set();
for (const m of misses) { const k = `${m.kind}|${m.value}|${m.why}`; if (s.has(k)) { uniq.find(u => `${u.kind}|${u.value}|${u.why}` === k).where += `, ${m.where}`; continue; } s.add(k); uniq.push({ ...m }); }
if (uniq.length) { console.log(`MISSES (${uniq.length}):`); for (const m of uniq) console.log(`  [${m.kind}] ${m.value}: ${m.why}  <- ${m.where}`); }
else console.log('MISSES: none');
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ checked_at: new Date().toISOString(), ref: REF, commit: head, api: API, counts: { files: byKind('file'), proofs: byKind('proof'), accounts: byKind('account'), code_hashes: byKind('code_hash'), sha256: byKind('sha256'), key_counts: byKind('fa_keys'), charter_code: byKind('charter_code') }, misses: uniq.map(({ kind, value, why, where }) => ({ kind, value, why, where })) }, null, 2) + '\n');
process.exit(uniq.length ? 1 : 0);
