// HTTP API (Hono). Read-only on chain; quotes are dry; no route can sign or spend.
import { buildLedger } from './ledger.js';
import * as agentMod from './agent.js';
import { Hono } from 'hono';
import { createHmac, randomBytes } from 'node:crypto';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { DEP, cfg, has } from './config.js';
import * as ferry from './ferry.js';
import { zcashRecipient } from './zcash.js';
import * as guard from './guardhouse.js';
import { attested } from './outlayer.js';
import * as mist from './mistbank.js';
import * as mq from './mistqueue.js';
import * as shops from './shops.js';
import * as tollgate from './tollgate.js';
import * as guest from './guest.js';
import * as ai from './ai.js';
import * as tee from './tee.js';
import * as vault from './vault.js';
import * as cp from './counterparty.js';
import { view, rpcStats } from './near.js';
import { limiter, clientIpSource, clientIdentity, proxyVerified, globalCap, edgeCache, leakGuard, onError, allowedOrigins, corsOrigin, OVERLOAD } from './http-guard.js';
import { pastPrompts as arenaPrompts } from './arena.js';

// Your House: a second charter on the same wasm, governed by its owner's wallet (no DAO).
async function houseView() {
  const H = DEP.house; if (!H) return null;
  const [snap, pending] = await Promise.all([guard.snapshot(H.oath), view(H.oath, 'get_pending')]);
  // get_pending is queued policy changes; held agent spends are actions with status "escalated", so read the latest few.
  const next = Number(snap.state.next_action || 0), actions = {};
  await Promise.all(Array.from({ length: Math.min(next, 8) }, (_, i) => String(next - 1 - i)).map(async id => { actions[id] = await guard.action(id, H.oath).catch(() => null); }));
  return { ...snap, owner: H.owner, dao: H.dao, code_hash: H.code_hash, pending, actions, proof_txs: H.proof_txs, demo: H.demo || null };
}

// Last good value per read: when every RPC endpoint is overloaded, serve it marked stale instead of failing.
const good = new Map();
const lastGood = (name, fn) => async () => {
  try { const v = await fn(); if (v != null) good.set(name, { at: Date.now(), v }); return v; }
  catch (e) {
    const g = good.get(name);
    if (g && OVERLOAD.test(String(e.message)) && Date.now() - g.at < 15 * 60e3)
      return g.v && typeof g.v === 'object' && !Array.isArray(g.v) ? { ...g.v, stale: true, stale_age_s: Math.round((Date.now() - g.at) / 1000) } : g.v;
    throw e;
  }
};
export const _resetLastGood = () => { good.clear(); swrs.clear(); };

// Stale-while-revalidate for slow display reads that rooms wait on (guardhouse, mistbank):
// fresh for ttl, then served from cache while one shared background read refreshes it.
export const READ_TTL_MS = 10_000, READ_STALE_MS = 5 * 60_000;
const swrs = new Map(); // name -> { v, at, p }
export const swr = (name, fn, { ttl = READ_TTL_MS, stale = READ_STALE_MS, now = Date.now } = {}) => async () => {
  const e = swrs.get(name) || {}; swrs.set(name, e);
  const refresh = () => e.p || (e.p = Promise.resolve().then(fn)
    .then(v => { if (v != null) { e.v = v; e.at = now(); } return v; })
    .finally(() => { e.p = null; }));
  const age = e.at == null ? Infinity : now() - e.at;
  if (age < ttl) return e.v;
  if (age < stale) { refresh().catch(() => {}); return e.v; }
  return refresh();
};

// One handler per public read route, shared by the routes and by /api/health?deep=1.
const reads = Object.fromEntries(Object.entries({
  guardhouse: swr('guardhouse', () => guard.snapshot()),
  attested: swr('attested', () => attested()),
  house: houseView,
  mistbank: swr('mistbank', () => mist.mistbank()),
  townhall: swr('townhall', () => shops.townhall(), { ttl: 10_000, stale: 15 * 60_000 }), // cold read 3.5-6 s seen live
  arena: () => shops.arena(),
  arena_attempts: () => shops.arenaAttempts(undefined, '2'),
  toll: () => shops.toll(),
  toll_gate: () => tollgate.gate(),
  chronicle: () => shops.chronicle(DEP.guardhouse.oath, 2),
  ferry_tokens: () => ferry.tokens(),
}).map(([k, fn]) => [k, lastGood(k, fn)]));

let deepCache = null; // { at, value }: deep checks cost ~20 RPC calls, so they are shared for 30 s
export async function deepHealth() {
  if (deepCache && Date.now() - deepCache.at < 30_000) return deepCache.value;
  const routes = {};
  await Promise.all(Object.entries(reads).map(async ([name, fn]) => {
    const t0 = Date.now();
    try {
      const v = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 20s')), 20_000))]);
      routes[name] = { ok: v != null, ms: Date.now() - t0 };
    } catch (e) { routes[name] = { ok: false, ms: Date.now() - t0, error: String(e.message).slice(0, 160) }; }
  }));
  const value = { routes_ok: Object.values(routes).every(r => r.ok), routes, rpc: { ...rpcStats, primary: cfg.rpc, fallback_urls: cfg.rpcFallbacks } };
  deepCache = { at: Date.now(), value };
  return value;
}

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const knownAccounts = new Set([DEP.guardhouse.oath, DEP.townhall.charter, DEP.townhall.dao, DEP.arena.contract, DEP.toll.oath,
  DEP.townhall_r16?.charter, DEP.toll_arbitrum?.oath, DEP.toll_usdc?.toll, DEP.toll_gate?.gate].filter(Boolean));
const bad = (c, m) => c.json({ error: m }, 400);
async function jsonBody(c) {
  try { const b = await c.req.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; }
}
const str = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;

// Boot pre-warm and keep-warm: the town feed and the reads a first room entry needs, so the first visitor after a
// deploy or a quiet spell is not the one who waits on the tx index and RPC. Errors are ignored (the routes retry).
export const WARM_EVERY_MS = Number(process.env.WARM_EVERY_MS) || 60_000;
// Vault Arena past prompts: a cold read is ~50 RPC views (8 s seen live), and the Arena room shows them,
// so serve them stale-while-revalidate (stale up to 1 h) and keep them warm every 2nd warm tick.
const arenaPromptsSwr = swr('arena_prompts', () => arenaPrompts(), { ttl: 30_000, stale: 60 * 60_000 });
// Public ledger: a cold read is the guardhouse + arena chronicles + toll + gate (4.8 s seen live), so it is served
// stale-while-revalidate (fresh 15 s, stale up to 30 min) and kept warm on alternate warm ticks (the two heavy reads never share a tick).
// Live feeds: the guardhouse oath and the shared arena pool. History feeds: the retired guardhouse (R11) and arena
// charters (R16/R17), which no longer have an agent key, so the deploy-time snapshot is used first and RPC only without one.
export const ledgerAccounts = () => ({ live: [DEP.guardhouse.oath, ...vault.sharedCharters()],
  history: [...(DEP.guardhouse_history || []).map(h => h.oath), ...vault.historyCharters()] });
export async function ledgerRead() {
    const soft = (p, ms = 9000) => Promise.race([p.catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
    const { live, history } = ledgerAccounts();
    const [feedsLive, feedsOld, toll] = await Promise.all([Promise.all(live.map(a => soft(shops.chronicle(a, shops.FEED_MAX)))),
      Promise.all(history.map(a => shops.feedSnapshot(a) || soft(shops.chronicle(a, shops.FEED_MAX)))), soft(shops.toll())]);
    const gate = await soft(tollgate.gate(), 6000);
    const feeds = [...feedsLive.map((f, i) => f ? (i === 0 ? shops.hideRetired(f) : f) : { busy: true }), ...feedsOld.filter(Boolean)];
    const seen = new Set(), txs = feeds.flatMap(f => f.txs || []).filter(t => !seen.has(t.hash) && seen.add(t.hash));
    const merged = { busy: feeds.some(f => f.busy), stale: feeds.some(f => f.stale), txs };
    return { ...buildLedger({ chronicle: merged, toll, gate, budget: agentMod.budgetStatus() }), charters: { live, history } };
}
const ledgerSwr = swr('ledger', ledgerRead, { ttl: 15_000, stale: 30 * 60_000 });
// First call after a restart: the ledger computed at deploy time (backend/data/feed-snapshots.json) is served at once,
// marked with its snapshot time, while the first live read runs in the background.
export const seedSwr = (name, v, at = Date.now()) => { if (v != null && !swrs.get(name)?.v) swrs.set(name, { v, at }); };
{ const snap = shops.ledgerSnapshot(); if (snap) seedSwr('ledger', { ...snap.ledger, stale: true, snapshot_at: snap.at }, Date.now() - 15_001); }

export const WARM_DELAY_MS = Number(process.env.WARM_DELAY_MS ?? 3_000);
// Reads run one at a time; the first tick waits WARM_DELAY_MS after boot so the health check is answered first.
export function warm({ every = WARM_EVERY_MS, read, delay = read ? 0 : WARM_DELAY_MS } = {}) {
  let tick = 0, stopped = false, t = null;
  const jobs = () => [() => shops.refreshHealth(), () => vault.refreshRunnerStatus(),
    () => shops.chronicle(DEP.guardhouse.oath, shops.FEED_MAX, ...(read ? [read] : [])),
    ...(read ? [] : [() => reads.guardhouse(), () => reads.mistbank(), () => reads.townhall(), tick++ % 2 === 0 ? () => arenaPromptsSwr() : () => ledgerSwr()])];
  const once = async () => { const out = []; for (const j of jobs()) { if (stopped) break; try { out.push({ status: 'fulfilled', value: await j() }); } catch (e) { out.push({ status: 'rejected', reason: e }); } } return out; };
  const first = new Promise(r => { const d = setTimeout(() => r(once().then(v => { if (every && !stopped) { t = setInterval(once, every); t.unref?.(); } return v; })), delay); if (delay) d.unref?.(); });
  return { first, stop: () => { stopped = true; t && clearInterval(t); } };
}

export function makeApp() {
  const app = new Hono();
  // Global caps (all clients together) on routes that spend a paid key: 1Click partner key, NEAR AI key.
  const oneClick = globalCap('1click', Number(process.env.CAP_1CLICK_PER_MIN || 60));
  const nearAi = globalCap('nearai', Number(process.env.CAP_NEARAI_PER_MIN || 12));
  app.use('/api/*', cors({ origin: corsOrigin(allowedOrigins()), allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['content-type'], maxAge: 600 }));
  app.use('/api/*', secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    crossOriginResourcePolicy: 'cross-origin', referrerPolicy: 'no-referrer', strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  }));
  app.use('/api/*', bodyLimit({ maxSize: 16 * 1024, onError: c => c.json({ error: 'body too large' }, 413) }));
  app.use('/api/*', leakGuard);
  app.onError(onError);
  app.notFound(c => c.json({ error: 'not found' }, 404));

  // ?deep=1 costs ~20 RPC reads: 3/min per client and 20/min for everyone (results are shared for 30 s anyway).
  const deepPer = limiter(3), deepGlobal = globalCap('health-deep', 20);
  const deepLimit = (c, next) => deepPer(c, () => deepGlobal(c, next));
  // ?deep=1 runs every read route's handler (not the AI or quote routes, which spend credits) and reports
  // each one's status and time, plus the RPC retry/fallback/stale counters.
  app.get('/api/health', (c, next) => c.req.query('deep') ? deepLimit(c, next) : next(), limiter(60), async c => c.json({ ...(c.req.query('deep') ? await deepHealth() : {}), ok: true, client_ip_from: clientIpSource(c)[0], network: DEP.network, near: c.req.query('deep') ? await shops.health() : shops.healthCached(),
    features: { confidentialQuotes: has.oneClick(), nearAi: has.nearAi(), signing: false }, vault_runner: c.req.query('deep') ? await vault.runnerStatus() : vault.runnerStatusCached() }));
  // Shows the caller how Render keys their own request, with no address in the answer: which header decides
  // the client key, a short keyed tag of that key (the same client gets the same tag until the process
  // restarts, so two visitors can see they are in different limit buckets), how many hops each IP header
  // lists, and the names (not values) of every other header.
  const IP_HEADERS = ['cf-connecting-ip', 'true-client-ip', 'x-forwarded-for', 'x-vercel-forwarded-for', 'x-real-ip', 'x-vercel-ip-country'];
  const TAG_KEY = randomBytes(32);
  const ipTag = v => v ? createHmac('sha256', TAG_KEY).update(String(v)).digest('hex').slice(0, 12) : null;
  app.get('/api/whoami', limiter(20), c => {
    const [from, ip, egress] = clientIdentity(c);
    const raw = c.req.raw.headers, seen = {};
    for (const n of IP_HEADERS) if (raw.get(n)) seen[n] = n === 'x-vercel-ip-country' ? 'set' : `${raw.get(n).split(',').length} hop(s)`;
    return c.json({ client_ip_from: from, client_tag: ipTag(ip), shared_cap: egress ? 'egress:' + ipTag(egress) : null, proxy_verified: proxyVerified(c), ip_headers: seen, header_names: [...raw.keys()].filter(n => !IP_HEADERS.includes(n)).sort() });
  });
  app.get('/api/deployments', limiter(30), c => c.json(DEP));

  // Ferry
  app.get('/api/ferry/tokens', limiter(30), async c => {
    const list = await ferry.tokens();
    return c.json(list.map(t => ({ assetId: t.assetId, symbol: t.symbol, chain: t.blockchain, decimals: t.decimals, price: t.price })));
  });
  // Several shops load the same dry quote at once: identical requests within 5 s share one 1Click call,
  // and a cached answer does not count against the per-client quota.
  const quoteKey = b => b && JSON.stringify([ferry.tokenRef(b.from), ferry.tokenRef(b.to), b.amount, b.recipient, b.refundTo, b.privacy || 'public', Number(b.slippageBps || 100)]);
  const quoteCache = new Map(), quoteInflight = new Map();
  const quoteShared = async (c, next) => {
    const k = quoteKey(await jsonBody(c)); if (!k) return next();
    const hit = quoteCache.get(k);
    if (hit && Date.now() - hit.at < 5000) { c.header('X-Quote-Cache', 'hit'); return c.json(hit.v); }
    if (quoteInflight.has(k)) { const v = await quoteInflight.get(k); if (v) { c.header('X-Quote-Cache', 'shared'); return c.json(v); } return next(); }
    // Register before any await so concurrent twins wait for this call; a refused or failed call shares nothing (null).
    let done; quoteInflight.set(k, new Promise(r => { done = r; }));
    c.set('quoteDone', v => { if (quoteCache.size > 500) quoteCache.clear(); quoteCache.set(k, { at: Date.now(), v }); done(v); });
    try { await next(); } finally { done(null); quoteInflight.delete(k); }
  };
  app.post('/api/ferry/quote', quoteShared, limiter(10), oneClick, async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    // from/to: {symbol, chain}, {assetId} or a string such as 'USDC@base' (see ferry.tokenRef).
    const from = ferry.tokenRef(b.from), to = ferry.tokenRef(b.to);
    if (!from) return bad(c, 'missing or bad from: use {symbol, chain} or "SYMBOL@chain"');
    if (!to) return bad(c, 'missing or bad to: use {symbol, chain} or "SYMBOL@chain"');
    for (const k of ['amount', 'recipient', 'refundTo']) if (!str(b[k], 300)) return bad(c, `missing or bad ${k}`);
    if (b.privacy !== undefined && !['public', 'basic', 'advanced'].includes(b.privacy)) return bad(c, 'privacy must be public|basic|advanced');
    if (b.slippageBps !== undefined && !(Number.isInteger(Number(b.slippageBps)) && Number(b.slippageBps) >= 0 && Number(b.slippageBps) <= 1000)) return bad(c, 'slippageBps must be 0..1000');
    const v = await ferry.quote({ from, to, amount: b.amount, recipient: b.recipient, refundTo: b.refundTo,
      privacy: b.privacy || 'public', slippageBps: Number(b.slippageBps || 100) });
    c.get('quoteDone')?.(v);
    return c.json(v);
  });
  app.get('/api/ferry/routes', limiter(30), async c => c.json(await ferry.routes()));
  app.get('/api/ferry/zcash/:addr', limiter(30), c => {
    try { return c.json(zcashRecipient(c.req.param('addr'))); } catch { return bad(c, 'not a valid Zcash address'); }
  });

  // Ferry deposit and status tracker (ENV=TIDEPOOL: community testnet, not 1Click). Any deposit address from a
  // Tidepool quote; the answer carries the status, refund amount and reason, and the verifier code-hash check.
  app.get('/api/ferry/status', limiter(30), async c => {
    const env = (c.req.query('env') || 'TIDEPOOL').toUpperCase();
    if (env !== 'TIDEPOOL') return bad(c, 'only env=TIDEPOOL deposits are tracked (live 1Click quotes are dry, no deposits)');
    try { return c.json(await ferry.tidepoolStatus(c.req.query('depositAddress'))); }
    catch (e) { return c.json({ error: e.message }, e.status || 502); }
  });
  app.get('/api/ferry/tidepool', limiter(20), c => c.json(DEP.ferry_tidepool ? { ...DEP.ferry_tidepool, label: ferry.TIDEPOOL.label } : { error: 'none' }, DEP.ferry_tidepool ? 200 : 404));

  // Guardhouse
  app.get('/api/guardhouse', limiter(120), edgeCache(15), async c => c.json(await reads.guardhouse()));
  // Your House: a second charter on the same wasm, governed by its owner's wallet (no DAO).
  app.get('/api/house', limiter(20), async c => { const h = await houseView(); return h ? c.json(h) : c.json({ error: 'no house' }, 404); });
  // House deed v2 (NEP-171): the deed is the house. Its purse and cap live in the deed contract and only the
  // current holder may spend (1 yocto, full wallet approval). The server never signs: /mint returns the unsigned
  // call for the visitor's wallet (NEAR Connect signAndSendTransaction); token_id is the minter's account id.
  const D = DEP.house_deed;
  const deedTx = (house) => ({ receiverId: D.contract, actions: [{ type: 'FunctionCall', params: { methodName: 'mint_deed',
    args: { house: house || null, cap: '50000000000000000000000' }, gas: D.mint.gas, deposit: D.mint.deposit_yocto } }] });
  app.get('/api/house/deed', limiter(20), async c => {
    if (!D) return c.json({ error: 'no deed contract' }, 404);
    const [metadata, total] = await Promise.all([view(D.contract, 'nft_metadata'), view(D.contract, 'nft_total_supply')]);
    return c.json({ ...D, metadata, total_supply: total });
  });
  app.get('/api/house/deed/mint', limiter(20), async c => {
    if (!D) return c.json({ error: 'no deed contract' }, 404);
    const house = c.req.query('house');
    if (house && !ACCT.test(house)) return c.json({ error: 'house must be an account id' }, 400);
    return c.json({ signer: 'the visitor (one deed per account; token_id = signer)', transaction: deedTx(house), note: 'unsigned; sign with your wallet. 0.02 NEAR pays storage, the rest fills the house purse (cap 0.05 NEAR per payment).' });
  });
  app.get('/api/house/deed/:account', limiter(20), async c => {
    if (!D) return c.json({ error: 'no deed contract' }, 404);
    const a = c.req.param('account'); if (!ACCT.test(a)) return c.json({ error: 'not an account id' }, 400);
    const [token, held] = await Promise.all([view(D.contract, 'nft_token', { token_id: a }), view(D.contract, 'nft_tokens_for_owner', { account_id: a, limit: 10 })]);
    const purses = Object.fromEntries(await Promise.all((held || []).map(async t => [t.token_id, await view(D.contract, 'house_purse', { token_id: t.token_id })])));
    return token || held?.length ? c.json({ contract: D.contract, token, held, purses }) : c.json({ contract: D.contract, token: null, held: [], mint: deedTx(null) }, 404);
  });
  // Counterparty check before a payment: allow / warn / block with reasons (backend/src/counterparty.js).
  // ?charter= must be a Nearcarta charter (served or made by the factory), so this never views arbitrary contracts.
  const cpCache = new Map();
  app.get('/api/guardhouse/check/:account', limiter(12), async c => {
    const a = c.req.param('account'); if (!ACCT.test(a) || a.length > 64) return bad(c, 'not an account id');
    const charter = c.req.query('charter') || DEP.guardhouse.oath;
    if (!ACCT.test(charter) || (!knownAccounts.has(charter) && !(await vault.isFactoryCharter(charter)))) return bad(c, 'charter must be a Nearcarta charter');
    const k = a + '|' + charter, hit = cpCache.get(k);
    if (hit && Date.now() - hit.at < 20_000) return c.json(hit.v);
    const v = await cp.check(a, { charter });
    cpCache.set(k, { at: Date.now(), v }); if (cpCache.size > 500) cpCache.delete(cpCache.keys().next().value);
    return c.json(v);
  });
  app.get('/api/guardhouse/attested', limiter(30), async c => c.json(await reads.attested()));
  app.get('/api/guardhouse/denylist', limiter(30), c => c.json(cp.DENY));
  app.get('/api/guardhouse/action/:id', limiter(30), async c => {
    const id = c.req.param('id'); if (!/^\d{1,9}$/.test(id)) return bad(c, 'action id must be a number');
    return c.json(await guard.action(id));
  });

  // Other shops
  // The desk's 1Click calls are cached 60 s inside mist.mistbank(), so this route cannot drain the key.
  app.get('/api/mistbank', limiter(120), edgeCache(15), async c => c.json(await reads.mistbank()));
  // Auditor flow: the opening is POSTed (not in a URL, so not in access logs) and never echoed back.
  app.post('/api/mistbank/verify', limiter(10), async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    return c.json(mist.verifyOpening(b.amount, b.salt));
  });
  app.get('/api/mistbank/verify', c => c.json({ error: 'POST {"amount":"<zatoshi>","salt":"<32 hex>"}; the opening is auditor-only and never goes in a URL' }, 405));
  // Per-visitor private send: verify the charter approval and queue it. The box worker holds the Zcash
  // key, sends after a random delay and reports back the txid + commitment only (src/mistqueue.js).
  app.get('/api/mistbank/send', limiter(20), c => c.json(mq.info()));
  app.post('/api/mistbank/send/prepare', limiter(20), async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    return c.json(mq.prepare(b.ua));
  });
  app.post('/api/mistbank/send', limiter(mq.LIMITS.per_ip_per_hour, 3600e3), async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    return c.json(await mq.enqueue(b), 202);
  });
  app.get('/api/mistbank/send/:id', limiter(30), c => c.json(mq.status(c.req.param('id'))));
  app.post('/api/mistbank/worker/sync', limiter(10), async c => {
    if (!mq.workerAuth(c.req.header('authorization'))) return c.json({ error: 'unauthorized' }, 401);
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    return c.json(mq.sync(b.records));
  });
  app.get('/api/mistbank/street/:txid', limiter(10), async c => c.json(mist.streetCheck(await mist.fetchStreet(c.req.param('txid')))));
  app.get('/api/townhall', limiter(20), async c => c.json(await reads.townhall()));
  app.get('/api/townhall/can-file/:account', limiter(20), async c => {
    const a = c.req.param('account');
    if (!/^[a-z0-9._-]{2,64}$/.test(a)) return bad(c, 'not a NEAR account id');
    return c.json(await shops.townhallCanFile(a));
  });
  app.get('/api/arena', limiter(20), async c => c.json(await reads.arena()));
  app.get('/api/arena/prompts', limiter(20), async c => c.json(await arenaPromptsSwr()));
  app.get('/api/arena/attempts', limiter(20), async c => c.json(await shops.arenaAttempts(c.req.query('from'), c.req.query('limit'))));
  app.get('/api/toll', limiter(20), async c => c.json(await reads.toll()));
  // Toll gate (v4): read the gate, one record, or relay the raw tx the gate signed on chain (nothing is signed here)
  const tg = fn => async c => { try { return c.json(await fn(c)); } catch (e) { if (e.status) return c.json({ error: e.message }, e.status); throw e; } };
  app.get('/api/toll/gate', limiter(20), tg(() => reads.toll_gate()));
  app.get('/api/toll/gate/:nonce', limiter(60), tg(c => tollgate.visit(c.req.param('nonce'))));
  // Guest fallback when the public faucet rate-limits a visitor (backend/src/guest.js)
  app.get('/api/guest', limiter(30), c => c.json(guest.guestInfo()));
  app.post('/api/guest', limiter(2, 3600e3, { persist: 'guest-ip' }), async c => {
    try { return c.json(await guest.createGuest(await c.req.json().catch(() => ({})))); }
    catch (e) { return c.json({ error: e.message }, e.status || 502); }
  });
  // Public relays spend the settler's testnet gas: per-client limits plus a town-wide cap per minute and per day.
  const relayMin = globalCap('toll-relay', Number(process.env.CAP_TOLL_RELAY_PER_MIN || 20)), relayDay = globalCap('toll-relay-day', Number(process.env.CAP_TOLL_RELAY_PER_DAY || 400), 24 * 3600e3);
  app.post('/api/toll/gate/settle-due', limiter(6), relayMin, relayDay, tg(() => tollgate.settleDue()));
  app.post('/api/toll/gate/:nonce/broadcast', limiter(10), relayMin, relayDay, tg(c => tollgate.broadcast(c.req.param('nonce'))));
  app.post('/api/toll/gate/:nonce/settle', limiter(10), relayMin, relayDay, tg(c => tollgate.settleOne(c.req.param('nonce'))));
  // The town's own feed (the guardhouse oath), so a page can ask for it without reading /api/deployments first.
  // Public ledger (/ledger): sales, payouts, refusals and today's inference cost, from the same live reads.
  app.get('/api/ledger', limiter(20), async c => c.json(await ledgerSwr()));
  app.get('/api/chronicle', limiter(120), edgeCache(15), async c => {
    const limit = Math.min(Number(c.req.query('limit') || 12), shops.FEED_MAX);
    try { return c.json(shops.hideRetired(await shops.chronicle(DEP.guardhouse.oath, limit))); }
    catch (e) {
      if (e.status || !/busy|http (429|5\d\d)|timeout|aborted|fetch failed/i.test(e.message)) throw e;
      c.header('Retry-After', '10'); return c.json({ account: DEP.guardhouse.oath, count: 0, txs: [], busy: true, source: 'tx index busy; try again in 10 s' });
    }
  });
  app.get('/api/chronicle/:account', limiter(120), edgeCache(15), async c => {
    const a = c.req.param('account');
    // Visitor charters made by the vault factory count too (B13 "What happened" feed): the id must sit under the
    // factory and the factory registry must list it, so this never becomes an open tx-index proxy.
    if (!knownAccounts.has(a) && !(await vault.isFactoryCharter(a))) return c.json({ error: 'not a Nearcarta contract' }, 400);
    // A busy tx index on a charter with no cached feed yet is not an error for the page (it keeps its own story and
    // polls again): answer 200 busy + Retry-After instead of 503, so a fresh visitor's console stays clean.
    const limit = Math.min(Number(c.req.query('limit') || 8), shops.FEED_MAX);
    // `known`: tx hashes the page itself sent (each re-read from RPC and kept only if it belongs to this account), so a
    // fresh charter's feed fills even when the index lags or is busy; the server adds the rows it already verified.
    const known = String(c.req.query('known') || '').split(',').filter(h => /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h)).slice(0, 15);
    let j;
    try { j = await shops.chronicle(a, limit); }
    catch (e) {
      if (e.status || !/busy|http (429|5\d\d)|timeout|aborted|fetch failed/i.test(e.message)) throw e;
      const hashes = [...known, ...vault.knownTxs(a).slice(-15)];
      if (hashes.length) { const f = await shops.chronicleFrom(a, hashes, limit); if (f.txs.length) return c.json(shops.hideRetired(f)); }
      c.header('Retry-After', '10'); return c.json({ account: a, count: 0, txs: [], busy: true, source: 'tx index busy; try again in 10 s' });
    }
    const have = new Set((j.txs || []).map(t => t.hash)), lag = known.filter(h => !have.has(h));
    if (lag.length) { // the index has not listed the page's newest txs yet: add them from RPC
      const f = await shops.chronicleFrom(a, lag, limit);
      if (f.txs.length) j = { ...j, txs: [...f.txs, ...j.txs].sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, limit), source: j.source + ' + known tx hashes' };
      j.count = j.txs.length;
    }
    return c.json(shops.hideRetired(j));
  });
  // R16 oath charters: on-chain reputation (refusal buckets) and one clause's user-set rules. Read-only views;
  // older charters (R14/R15) have no such method and answer { supported: false }.
  const oathRead = (method, args) => async c => {
    const a = c.req.param('account');
    if (!ACCT.test(a)) return c.json({ error: 'not an account id' }, 400);
    try {
      const v = await view(a, method, args(c));
      if (v == null) return c.json({ error: 'no such clause' }, 404);
      if (method === 'get_rules') {
        // valid_until: the clause's on-chain expiry (R16 set_clause_expiry, ns) under the name the shops use; null = no expiry.
        const ns = v.expires_at ?? null;
        return c.json({ account: a, supported: true, rules: v, valid_until: ns, valid_until_iso: ns ? new Date(Number(BigInt(ns) / 1_000_000n)).toISOString() : null });
      }
      return c.json({ account: a, supported: true, reputation: v });
    }
    catch (e) {
      const m = String(e.message);
      if (/MethodNotFound|CodeDoesNotExist|does not exist/i.test(m)) return c.json({ account: a, supported: false, note: 'needs an R16 oath charter' });
      // upstream RPC overload (429/5xx/timeout on every endpoint): say so instead of a generic 500
      if (/http (429|5\d\d)|timeout|aborted/i.test(m)) { c.header('Retry-After', '10'); return c.json({ error: 'rpc busy, retry shortly' }, 503); }
      throw e;
    }
  };
  app.get('/api/charter/:account/reputation', limiter(20), oathRead('get_reputation', () => ({})));
  app.get('/api/charter/:account/rules/:clause', limiter(20), async (c, n) => {
    if (!/^[a-z0-9_-]{1,64}$/.test(c.req.param('clause'))) return c.json({ error: 'bad clause id' }, 400);
    return oathRead('get_rules', c => ({ clause_id: c.req.param('clause') }))(c, n);
  });
  app.get('/api/tx/:hash', limiter(20), async c => {
    const h = c.req.param('hash'), s = c.req.query('sender');
    if (!HASH.test(h) || !s || !ACCT.test(s)) return c.json({ error: 'need tx hash and ?sender=' }, 400);
    return c.json(await shops.explainAny(h, s));
  });

  // NEAR AI Cloud
  app.get('/api/ai/attestation', limiter(6), nearAi, async c => c.json(await ai.attestation(cfg.nearAiModel)));
  // Full TEE preflight (dcap-qvl quote, nonce + signer binding, MRCONFIGID, RTMR3 replay, NVIDIA NRAS).
  // Non-billable. ?nonce= lets the caller supply its own 32-byte hex nonce.
  app.get('/api/ai/tee/models', limiter(6), nearAi, async c => c.json(await tee.attestedModels()));
  // Answered from a 5-minute cache when the same nonce (or no nonce) was checked recently (tee.cachedProveTee);
  // only a miss, which fetches a fresh quote, counts against the per-client limit and its own global cap.
  // A loose guard (60/min per client) still stops anyone hammering cache hits.
  const teeAny = limiter(60), teeMiss = limiter(Number(process.env.TEE_MISS_PER_MIN || 20)), teeCap = globalCap('nearai-tee', Number(process.env.CAP_NEARAI_TEE_PER_MIN || 60));
  app.get('/api/ai/tee', teeAny, async c => {
    const model = c.req.query('model'), nonce = c.req.query('nonce') || undefined;
    if (nonce !== undefined && !/^[0-9a-f]{64}$/i.test(nonce)) return bad(c, 'nonce must be 32 bytes as 64 hex chars');
    const opts = { nonce, ...(model ? { model } : {}) };
    const run = async () => {
      if (model && (model.length > 120 || !(await tee.attestedModels()).attested.some(m => m.id === model))) return bad(c, 'that model has no TEE attestation; see /api/ai/tee/models');
      return c.json(await tee.cachedProveTee(opts));
    };
    if (tee.teeCached(opts)) return run();
    return teeMiss(c, () => teeCap(c, run));
  });
  app.post('/api/ai/prove', limiter(3), nearAi, async c => {
    // Completions are billable. This demo route is off unless AI_PROVE_ENABLED=1; the agent (agent.js) has its own budget.
    if (process.env.AI_PROVE_ENABLED !== '1') return c.json({ error: 'completions disabled on this deployment (AI_PROVE_ENABLED!=1)' }, 403);
    return c.json(await ai.prove());
  });
  // Charters (factory) and Vault Arena: backend/src/vault.js
  vault.register(app, { limiter, globalCap });
  return app;
}
