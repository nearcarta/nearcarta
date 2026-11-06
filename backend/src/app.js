// HTTP API (Hono). Read-only on chain; quotes are dry; no route can sign or spend.
import { buildLedger } from './ledger.js';
import * as agentMod from './agent.js';
import { Hono } from 'hono';
import { createHmac, randomBytes } from 'node:crypto';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { DEP, MAINNET_DEP, cfg, has, secret } from './config.js';
import * as ferry from './ferry.js';
import * as checkout from './ferry-checkout.js';
import * as payoutsInvoice from './payouts-invoice.js';
import * as payoutsPayroll from './payouts-payroll.js';
import { parsePayoutIntent } from './payouts-intent.js';
import { zcashRecipient } from './zcash.js';
import * as guard from './guardhouse.js';
import { attested } from './outlayer.js';
import { attestedVerdict } from './guard-attested.js';
import * as mist from './mistbank.js';
import * as shops from './shops.js';
import * as tollgate from './tollgate.js';
import { issuePass } from './toll-pass.js';
import { describeVisitorPass, readTollLive, tollContractId, tollLiveError } from './toll-views.js';
import { broadcastLatest, relayById } from './toll-relay.js';
import { verifyPropose } from './board-tx.js';
import { mainnetChronicle } from './board-chronicle.js';
import { previewOwner } from './board-guard.js';
import * as ai from './ai.js';
import * as bankProof from './bank-proof.js';
import * as bankRate from './bank-rate.js';
import * as bankModel from './bank-model.js';
import * as tee from './tee.js';
import * as vault from './vault.js';
import * as cp from './counterparty.js';
import { view, viewAccount, txStatus, rpcStats } from './near.js';
import { accountTxHashes, readLive } from './chronicle-live.js';
import { anchorIndex } from './chronicle-index.js';
import { signStatement } from './chronicle-statement.js';
import { nearAccountOk } from '../../shared/net/accounts.js';
import { txVerdict } from '../../shared/net/tx-verdict.js';
import { limiter, clientIpSource, clientIdentity, proxyVerified, globalCap, edgeCache, leakGuard, onError, allowedOrigins, corsOrigin, OVERLOAD } from './http-guard.js';
import { pastPrompts as arenaPrompts } from './arena.js';
import { receiptsBody } from '../../shared/rails/receipts.js';
import { marketStatus, marketWorkers, readBounties } from './hall-market.js';
import { derivedFor, lineFor } from './house-views.js';
import { HOUSE_LEGACY, HOUSE_SHOP } from '../../shared/house/shop.js';

// Your House: a second charter on the same wasm, governed by its owner's wallet (no DAO).
async function houseView() {
  const recorded = DEP.house && typeof DEP.house === 'object' ? DEP.house : DEP.extras?.house;
  const H = recorded && typeof recorded === 'object' ? recorded : null;
  if (!H) return null;
  // The mainnet house record is the deed contract. It has no oath account, so this must not call view() on an empty id.
  if (!H.oath) {
    return {
      kind: 'deed',
      contract: HOUSE_SHOP,
      legacy: HOUSE_LEGACY,
      owner: H.owner || null,
      code_hash: H.code_hash || null,
      txs: H.txs || null,
      note: 'The city shop is extras.house.shop. extras.house.legacy is the recorded shop. A visitor charter is a board row, read with get_charter.',
    };
  }
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
    // A retired or missing contract is a fact about the deployment, not a server fault.
    // The room reads this instead of a 500, which used to take the whole city tray down.
    if (e?.status === 404 || e?.status === 503) {
      return { error: String(e.message || 'unavailable').slice(0, 200), retired: true, status: e.status, at: new Date().toISOString() };
    }
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
  chronicle: () => MAINNET_DEP?.charter?.contract ? shops.chronicle(MAINNET_DEP.charter.contract, 2) : Promise.resolve(mainnetChronicle()),
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
  const value = { routes_ok: Object.values(routes).every(r => r.ok), routes, rpc: { ...rpcStats, primary: cfg.mainnetRpc, fallback_urls: cfg.rpcFallbacks } };
  deepCache = { at: Date.now(), value };
  return value;
}

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
// The live guard charter: the visitor's row lives on the board. The retired oath must never
// be a default again (mainnet.json `retired`).
const BOARD_ID = MAINNET_DEP?.board?.contract || null;
const knownAccounts = new Set([
  MAINNET_DEP?.charter?.contract, MAINNET_DEP?.board?.contract, MAINNET_DEP?.toll?.contract,
  MAINNET_DEP?.extras?.arena?.contract, MAINNET_DEP?.extras?.house?.contract,
  DEP.guardhouse?.oath, DEP.townhall?.charter, DEP.townhall?.dao, DEP.arena?.contract, DEP.toll?.oath,
  DEP.townhall_r16?.charter, DEP.toll_arbitrum?.oath, DEP.toll_usdc?.toll, DEP.toll_gate?.gate,
].filter(Boolean));
const bad = (c, m) => c.json({ error: m }, 400);
// Bounded storage sponsorship for a zero-NEAR issuer. It is on by default because the deposit comes
// from the visitor's own session cap through their own row, never from the shop; an owner who does not
// want the row to be able to call storage_deposit can set PAYOUTS_SPONSOR_STORAGE=0.
// There is no amount here: the deposit is the USDC contract's own storage_balance_bounds.min.
export const payoutsSponsorEnabled = (env = process.env) => String(env.PAYOUTS_SPONSOR_STORAGE || '').trim() !== '0';
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
// Public ledger: mainnet accounts from shared/deployments/mainnet.json only. Served stale-while-revalidate
// (fresh 15 s, stale up to 30 min) and kept warm on alternate warm ticks.
export const ledgerAccounts = () => {
  const m = MAINNET_DEP || {};
  return { live: [m.charter?.contract, m.extras?.arena?.contract].filter(Boolean), history: [] };
};
export async function ledgerRead() {
    const soft = (p, ms = 9000) => Promise.race([p.catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
    const { live, history } = ledgerAccounts();
    const [feedsLive, toll] = await Promise.all([
      Promise.all(live.map(a => soft(shops.chronicle(a, shops.FEED_MAX)))),
      soft(shops.toll()),
    ]);
    const feeds = feedsLive.map(f => f || { busy: true });
    const seen = new Set(), txs = feeds.flatMap(f => f.txs || []).filter(t => !seen.has(t.hash) && seen.add(t.hash));
    const merged = { busy: feeds.some(f => f.busy), stale: feeds.some(f => f.stale), txs };
    return { ...buildLedger({ chronicle: merged, toll, board: mainnetChronicle(), budget: agentMod.budgetStatus() }), charters: { live, history } };
}
const ledgerSwr = swr('ledger', ledgerRead, { ttl: 15_000, stale: 30 * 60_000 });
// The deployments record is a file, not a chain read. One body is reused by /api/mainnet and
// /api/chronicle, and the Chronicle tray used to ask for it again on every account read.
let depBody = null, depAt = 0;
export function deploymentsBody(now = Date.now()) {
  if (depBody && now - depAt < 5 * 60_000) return depBody;
  depBody = MAINNET_DEP || { status: 'not_deployed' };
  depAt = now;
  return depBody;
}
// Seed the ledger cache only from a mainnet snapshot.
export const seedSwr = (name, v, at = Date.now()) => { if (v != null && !swrs.get(name)?.v) swrs.set(name, { v, at }); };
{ const snap = shops.ledgerSnapshot(); if (snap?.ledger?.network === 'mainnet') seedSwr('ledger', { ...snap.ledger, stale: true, snapshot_at: snap.at }, Date.now() - 15_001); }

export const WARM_DELAY_MS = Number(process.env.WARM_DELAY_MS ?? 3_000);
// Reads run one at a time; the first tick waits WARM_DELAY_MS after boot so the health check is answered first.
export function warm({ every = WARM_EVERY_MS, read, delay = read ? 0 : WARM_DELAY_MS } = {}) {
  let tick = 0, stopped = false, t = null;
  const warmOath = () => MAINNET_DEP?.board?.contract || DEP.guardhouse?.oath || null;
  const jobs = () => [() => shops.refreshHealth(),
    () => { const a = warmOath(); return a ? shops.chronicle(a, shops.FEED_MAX, ...(read ? [read] : [])) : null; },
    ...(read ? [] : [() => reads.mistbank(), tick++ % 2 === 0 ? () => arenaPromptsSwr() : () => ledgerSwr()])];
  const once = async () => { const out = []; for (const j of jobs()) { if (stopped) break; try { out.push({ status: 'fulfilled', value: await j() }); } catch (e) { out.push({ status: 'rejected', reason: e }); } } return out; };
  const first = new Promise(r => { const d = setTimeout(() => r(once().then(v => { if (every && !stopped) { t = setInterval(once, every); t.unref?.(); } return v; })), delay); if (delay) d.unref?.(); });
  return { first, stop: () => { stopped = true; t && clearInterval(t); } };
}

export function makeApp() {
  const app = new Hono();
  // Pay is embedded on other sites. These routes carry no cookie, so any origin may call them.
  // The charter view and the visitor's row cap both run before a deposit address is created.
  const payCors = cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['content-type'], maxAge: 600 });
  for (const p of ['/api/ferry/checkout', '/api/ferry/rules', '/api/ferry/status', '/api/mainnet']) app.use(p, payCors);
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
  app.get('/api/health', (c, next) => c.req.query('deep') ? deepLimit(c, next) : next(), limiter(60), async c => {
    const near = c.req.query('deep') ? await shops.health() : shops.healthCached();
    return c.json({ ...(c.req.query('deep') ? await deepHealth() : {}), ok: true, client_ip_from: clientIpSource(c)[0], network: { contracts: MAINNET_DEP?.status === 'deployed' ? 'mainnet' : null, journey: 'mainnet' }, near,
      features: { confidentialQuotes: has.oneClick(), nearAi: has.nearAi(), signing: false }, vault_runner: { enabled: false, charter: MAINNET_DEP?.extras?.arena?.contract || null }, git: process.env.GIT_SHA || null });
  });
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
  app.get('/api/deployments', limiter(30), c => c.json(MAINNET_DEP || { status: 'not_deployed' }));
  // The deployments record is a file, not a chain read: cached at the edge and in this process,
  // so the tray's per-account ask does not cost a route call each time.
  app.get('/api/mainnet', limiter(120), edgeCache(60), c => c.json(deploymentsBody()));
  app.get('/api/receipts', limiter(30), c => c.json(receiptsBody(MAINNET_DEP || {}, agentMod.budgetStatus(), { jobTokens: agentMod.MAX_TOKENS, checkouts: checkout.listCheckoutReceipts() })));

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
  // Checkout: a deposit address only after the charter view allows the recipient and the
  // amount fits the visitor's row. There is no product-wide USD cap.
  // The route does not sign and does not send the deposit. The payer sends it from their own wallet.
  app.get('/api/ferry/rules', limiter(30), async c => {
    const out = await checkout.rulesFor(c.req.query('charter') || '', c.req.query('clause') || 'pay');
    const { httpStatus, ...body } = out;
    return c.json(body, httpStatus || 200);
  });
  app.post('/api/ferry/checkout', limiter(6), oneClick, async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    const out = await checkout.startCheckout(b);
    const { httpStatus, ...body } = out;
    if (httpStatus === 400) return bad(c, out.error);
    return c.json(body);
  });
  app.get('/api/ferry/routes', limiter(30), async c => c.json(await ferry.routes()));
  app.get('/api/ferry/zcash/:addr', limiter(30), c => {
    try { return c.json(zcashRecipient(c.req.param('addr'))); } catch { return bad(c, 'not a valid Zcash address'); }
  });

  app.get('/api/ferry/status', limiter(30), async c => {
    try { return c.json(await checkout.oneClickStatus(c.req.query('depositAddress'))); }
    catch (e) { return c.json({ error: e.message }, e.status || 502); }
  });

  // Guardhouse
  app.get('/api/payouts/usdc', limiter(30), edgeCache(15), c => c.json({
    network: 'mainnet', mode: 'reviewed rows', usdc: 'invoice',
    ceiling: payoutsInvoice.hostedCeiling(process.env),
    sponsorship: { enabled: payoutsSponsorEnabled(), contract: payoutsInvoice.USDC_NEAR_CONTRACT, minNearRead: 'storage_balance_bounds.min' },
    note: 'Every row is paid by the visitor session under their own /setup cap: a NEAR row by propose on the board, a foreign row by the same session through the 1Click intents rail (a priced quote, not a stored rate). An over-cap row is refused before any deposit. An invoice is EXACT_OUTPUT and is not paid until 1Click says SUCCESS.',
  }));
  // A foreign payroll row is priced by a dry 1Click quote. EXACT_OUTPUT: the payee gets exactly `amt`
  // of `asset` on `chain`. The signed quote names the wNEAR the session deposits. No deposit address,
  // nothing is sent, and the route does not sign.
  app.post('/api/payouts/payroll/quote', limiter(20), oneClick, async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    const out = await payoutsInvoice.quotePayrollRow(b);
    return c.json(out, out.ok ? 200 : 400);
  });
  // A foreign payroll row's live quote: the visitor's own board row is the gate, then 1Click returns
  // a deposit address for the wNEAR the session will deposit. Nothing here signs or sends the deposit.
  app.post('/api/payouts/payroll/checkout', limiter(6), oneClick, async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    const parsed = payoutsPayroll.payrollCheckoutInput(b);
    if (parsed.error) return bad(c, parsed.error);
    const board = MAINNET_DEP?.board?.contract;
    const owner = String(b.owner || '').trim();
    let row = null;
    if (board && owner && ACCT.test(owner)) {
      try { row = await view(board, 'get_charter', { owner }); } catch { row = null; }
    }
    if (!row) return c.json({ ok: false, reason: 'no_row', depositAddress: null, help: 'Open your row in /setup first. Nothing was sent.' }, 400);
    const out = await payoutsPayroll.openPayrollCheckout(parsed.value, { row });
    return c.json(out, out.ok ? 200 : 400);
  });
  app.get('/api/payouts/payroll/status', limiter(30), async c => {
    try { return c.json(await payoutsPayroll.payrollStatus(c.req.query('depositAddress'))); }
    catch (e) { return c.json({ error: e.message, paid: false, final: false }, e.status || 502); }
  });
  // Bounded storage sponsorship: the min the USDC contract asks for, read from its own bounds.
  // This returns the board propose_call the visitor's session would make; it does not sign or send it.
  app.get('/api/payouts/sponsor', limiter(30), edgeCache(15), async c => {
    const account = c.req.query('account') || '';
    if (!account) return bad(c, 'account is required');
    const reg = await payoutsInvoice.registrationOf(account, { view, viewAccount });
    if (reg.reason === 'missing_account') return c.json({ ok: false, ...reg }, 400);
    let minNear;
    try {
      const bounds = await view(payoutsInvoice.USDC_NEAR_CONTRACT, 'storage_balance_bounds', {});
      minNear = payoutsInvoice.nearFromYocto(bounds?.min);
    } catch { minNear = undefined; }
    // The row's own cap, budget and balance decide whether this is allowed; the page passes them.
    return c.json({
      enabled: payoutsSponsorEnabled(),
      account,
      minNear: minNear ?? payoutsInvoice.USDC_STORAGE_NEAR,
      registered: reg.registered,
      claim: reg.claim,
      contract: payoutsInvoice.USDC_NEAR_CONTRACT,
    });
  });
  // Durable invoices. Creating one does not call 1Click. Checkout may ask for a deposit address.
  // Nothing here signs or sends the deposit. The receive account is the one stored on the invoice.
  app.post('/api/payouts/intent', limiter(12), async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    return c.json(await parsePayoutIntent(String(b.text || '').slice(0, 400)));
  });
  app.get('/api/payouts/invoices', limiter(30), c => {
    const out = payoutsInvoice.listInvoices(c.req.query('visitor'));
    return c.json(out, out.ok ? 200 : 400);
  });
  app.post('/api/payouts/invoices', limiter(10), async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    const who = String(b.receive || b.recipient || '').trim();
    if (who) {
      const reg = await payoutsInvoice.registrationOf(who, { view, viewAccount });
      if (reg.reason === 'missing_account') return c.json({ ok: false, depositAddress: null, invoice: null, ...reg }, 400);
    }
    const out = payoutsInvoice.createInvoice(b);
    return c.json(out, out.ok ? 200 : 400);
  });
  app.get('/api/payouts/invoices/:id', limiter(30), c => {
    const q = c.req.query();
    const out = payoutsInvoice.readInvoice(c.req.param('id'), q);
    return c.json(out, out.ok ? 200 : 404);
  });
  app.post('/api/payouts/invoices/:id/quote', limiter(10), oneClick, async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    const parsed = payoutsInvoice.payerInput(b, { allowIndicative: true });
    if (parsed.error) return bad(c, parsed.error);
    const out = await payoutsInvoice.quoteStored(c.req.param('id'), parsed.value);
    return c.json(out, out.ok ? 200 : 400);
  });
  app.post('/api/payouts/invoices/:id/checkout', limiter(6), oneClick, async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    const parsed = payoutsInvoice.payerInput(b);
    if (parsed.error) return bad(c, parsed.error);
    const out = await payoutsInvoice.checkoutInvoice(c.req.param('id'), parsed.value);
    return c.json(out, out.ok ? 200 : 400);
  });
  app.get('/api/payouts/invoices/:id/status', limiter(30), async c => {
    try { return c.json(await payoutsInvoice.refreshInvoice(c.req.param('id'))); }
    catch (e) { return c.json({ error: e.message, delivered: false }, e.status || 502); }
  });
  app.get('/api/payouts/registration', limiter(30), async c => {
    const out = await payoutsInvoice.registrationOf(c.req.query('account'), { view, viewAccount });
    return c.json(out, out.ok ? 200 : 400);
  });
  // The live charter is the visitor row on the board (mainnet.json: charter.nearcarta.near is
  // retired, so oathId resolves to the board). `?owner=` adds that visitor's live row. A retired
  // or missing contract answers a readable state from lastGood, never a 500.
  app.get('/api/guardhouse', limiter(120), edgeCache(15), async c => {
    const owner = c.req.query('owner');
    const snap = await guard.snapshot();
    if (!owner) return c.json(snap);
    const row = await guard.boardSnapshot(guard.boardId, { owner });
    return c.json({ ...snap, owner: row.owner, has_row: row.has_row, row: row.row, config: row.config, liabilities: row.liabilities });
  });
  // Your House: a second charter on the same wasm, governed by its owner's wallet (no DAO).
  app.get('/api/house', limiter(20), async c => { const h = await houseView(); return h ? c.json(h) : c.json({ error: 'no house' }, 404); });
  // House deed (NEP-171): the deed is the house. Its purse and cap live in the shop contract and only the
  // current holder may spend (1 yocto, full wallet approval). The server never signs: /mint returns the unsigned
  // call for the visitor's wallet (NEAR Connect signAndSendTransaction); token_id is the minter's account id.
  // The live shop is extras.house.shop. house_deed was never a key in mainnet.json, so these routes used to 404
  // and the city could never load a deed. Contracts/house_nft mint_deed takes {house, cap} and 0.02 NEAR minimum.
  const D = DEP.house_deed || { contract: HOUSE_SHOP, mint: { gas: '100000000000000', deposit_yocto: '20000000000000000000000' } };
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
  app.get('/api/house/derived/:account', limiter(12), async c => {
    const a = c.req.param('account');
    if (!nearAccountOk(a)) return bad(c, 'not an account id');
    return c.json(await derivedFor(a, view));
  });
  app.get('/api/house/line/:account', limiter(12), async c => {
    const a = c.req.param('account');
    if (!nearAccountOk(a)) return bad(c, 'not an account id');
    if (!D) return c.json({ live: false, line: null, why: 'house_line is not on this deed. Nothing was signed.' });
    return c.json(await lineFor(a, D.contract, view));
  });
  // Counterparty check before a payment: allow / warn / block with reasons (backend/src/counterparty.js).
  // ?charter= must be a Nearcarta charter: a known contract, a factory charter, or a row opened on the board.
  // A board row's owner account is the charter. It has no get_clauses of its own.
  const cpCache = new Map();
  // A retired or deleted contract is not a charter: mainnet.json records why and where the money went.
  const retiredAccount = (id) => !!(MAINNET_DEP?.retired && Object.prototype.hasOwnProperty.call(MAINNET_DEP.retired, id));
  async function nearcartaCharter(charter) {
    if (!ACCT.test(charter)) return null;
    if (retiredAccount(charter)) return null;
    if (knownAccounts.has(charter)) return { kind: 'known' };
    if (await vault.isFactoryCharter(charter)) return { kind: 'factory' };
    const board = MAINNET_DEP?.board?.contract;
    if (!board) return null;
    try {
      const row = await view(board, 'get_charter', { owner: charter });
      if (row && (row.owner === charter || row.per_action_cap != null)) return { kind: 'board', row };
    } catch { /* the account has no row */ }
    return null;
  }
  app.get('/api/guardhouse/check/:account', limiter(12), async c => {
    const a = c.req.param('account'); if (!ACCT.test(a) || a.length > 64) return bad(c, 'not an account id');
    // The default charter is the live board, never the retired oath. The board is a
    // Nearcarta contract (`known`), so a guest check compares against the deny list and
    // the account signals; a ?charter= that names a board row owner supplies that row's
    // allowlist. charter.nearcarta.near is reaped and must never be a default again.
    // A retired or unknown contract is refused plainly instead of being read as today's
    // rules, and the read must never 500 (a retired oath took the whole city tray down).
    const asked = c.req.query('charter');
    const charter = c.req.query('charter') || BOARD_ID || null;
    let found = null;
    if (charter) {
      found = await nearcartaCharter(charter).catch(() => null);
      if (!found) return bad(c, asked ? 'charter must be a Nearcarta charter' : 'the board did not answer, try again');
    }
    const k = `${a}|${charter || ''}`, hit = cpCache.get(k);
    if (hit && Date.now() - hit.at < 20_000) return c.json(hit.v);
    const v = await cp.check(a, { charter, row: found?.row || null });
    if (!charter) v.no_allowlist = 'no charter was named, so no allowlist was read';
    cpCache.set(k, { at: Date.now(), v }); if (cpCache.size > 500) cpCache.delete(cpCache.keys().next().value);
    return c.json(v);
  });
  // Attested verdict for one typed payment. The payment context is hashed and becomes the TEE
  // nonce, so the report is bound to this payee/amount/invoice/row and to nothing else. Without
  // a context it reports the scheme and the reason it is off, never a bare `enabled:false`.
  app.get('/api/guardhouse/attested', limiter(30), async c => {
    const q = c.req.query();
    const has = ['payee', 'amount'].every(k => typeof q[k] === 'string' && q[k].length);
    if (!has) return c.json({ ...(await reads.attested()), context: null, need: 'pass payee and amount to bind a verdict to a payment' });
    if (q.payee.length > 64 || q.amount.length > 40) return bad(c, 'payee or amount too long');
    const out = await attestedVerdict({
      payee: q.payee, chain: q.chain || 'near', asset: q.asset || 'NEAR', amount: q.amount,
      invoice: q.invoice || '', row: q.row || '', keyEpoch: q.keyEpoch || '', policyVersion: q.policyVersion || '',
    });
    return c.json(out);
  });
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
  app.post('/api/mistbank/mainnet', limiter(10), async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    if (!HASH.test(b.tx || '')) return bad(c, 'tx must be a hash');
    if (!ACCT.test(b.signer || '')) return bad(c, 'signer must be an account');
    try {
      const j = await verifyPropose(b.tx, b.signer, b.payee ? { expectReceiver: b.payee } : {});
      if (!j.ok) return c.json({ error: j.error }, j.status || 400);
      return c.json({ network: 'mainnet', ...j });
    } catch (e) { return c.json({ error: e.message }, e.status || 502); }
  });
  app.get('/api/mistbank/street/:txid', limiter(10), async c => c.json(mist.streetCheck(await mist.fetchStreet(c.req.param('txid')))));
  app.get('/api/hall/market', limiter(20), async c => {
    // Public worker discovery needs no token; the token path adds the buyer view.
    const { workers, status } = await marketWorkers({ fetchImpl: fetch });
    return c.json(await marketStatus({ token: secret.hallMarket(), fetchImpl: fetch, workers, agentsStatus: status }));
  });
  // Real third-party agents on the market, no credential and no write.
  app.get('/api/hall/workers', limiter(30), async c => c.json(await marketWorkers({ fetchImpl: fetch })));
  app.get('/api/hall/bounties', limiter(20), async c => c.json(await readBounties({ view })));
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
  // One visitor's own derived address for their toll row. Read-only: `address_of` on the
  // toll contract. Null until that row's first signature recovers an address. Two rows
  // have two paths, so two addresses; nothing here is shared or invented.
  app.get('/api/toll/address/:owner', limiter(30), async c => {
    const owner = c.req.param('owner');
    if (!nearAccountOk(owner)) return bad(c, 'not an account id');
    try {
      const got = await view(tollContractId(), 'address_of', { row_owner: owner, chain: 'base' });
      return c.json({ owner, path: got?.path || null, address: got?.address || null });
    } catch (e) {
      return c.json({ owner, path: null, address: null, error: String(e?.message || e).slice(0, 160) }, 502);
    }
  });
  // Toll gate (v4): read the gate, one record, or relay the raw tx the gate signed on chain (nothing is signed here)
  const tg = fn => async c => { try { return c.json(await fn(c)); } catch (e) { if (e.status) return c.json({ error: e.message }, e.status); throw e; } };
  app.get('/api/toll/gate', limiter(20), tg(() => reads.toll_gate()));
  app.get('/api/toll/live', limiter(20), async c => {
    try {
      const live = await readTollLive(view);
      const recent = (live.recent || []).map(({ raw_signed, ...rest }) => rest);
      return c.json({ ...live, recent });
    }
    catch (e) { return c.json(tollLiveError(e)); }
  });
  app.post('/api/toll/relay', limiter(10), async c => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const live = await readTollLive(view);
      return c.json(await relayById({ id: body.id, policy: live, txs: live.recent }));
    } catch (e) {
      return c.json({ ok: false, claim: 'none', text: 'The chain check did not answer. Nothing moved on Base.', error: String(e.message || 'no status').slice(0, 160) });
    }
  });
  app.post('/api/toll/broadcast', limiter(10), async c => {
    try {
      const live = await readTollLive(view);
      return c.json(await broadcastLatest({ policy: live, txs: live.recent }));
    } catch (e) {
      return c.json({ ok: false, claim: 'none', text: 'The chain check did not answer. Nothing moved on Base.', error: String(e.message || 'no status').slice(0, 160) });
    }
  });
  app.get('/api/toll/pass/:hash', limiter(20), async c => {
    const hash = c.req.param('hash');
    const sender = c.req.query('sender') || '';
    if (!HASH.test(hash) || !nearAccountOk(sender)) return bad(c, 'need a tx hash and ?sender=');
    try {
      const judged = await verifyPropose(hash, sender, { expectReceiver: 'toll.nearcarta.near' });
      const words = describeVisitorPass(judged, { hash });
      return c.json({ ...judged, hash, text: words.text });
    } catch (e) {
      return c.json({ ok: false, hash, text: 'The chain check did not answer. Nothing moved on Base.', error: String(e.message || 'no status').slice(0, 160) });
    }
  });
  app.post('/api/toll/mainnet', limiter(10), async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    if (!HASH.test(b.tx || '')) return bad(c, 'tx must be a hash');
    if (!ACCT.test(b.signer || '')) return bad(c, 'signer must be an account');
    try { return c.json(await issuePass({ hash: b.tx, signer: b.signer })); }
    catch (e) { return c.json({ error: e.message }, e.status || 502); }
  });
  // The board's own config: owner, rows, and the row cap. The city dashboards read this
  // instead of the retired oath account.
  app.get('/api/board/config', limiter(30), edgeCache(15), async c => {
    const board = MAINNET_DEP?.board?.contract;
    if (!board) return c.json({ error: 'no board' }, 404);
    try {
      const config = await view(board, 'get_config', {}, cfg.rpc);
      return c.json({ board, config: config || null, source: 'board' });
    } catch (e) { return c.json({ board, config: null, error: e.message }, 502); }
  });
  app.get('/api/board/row/:owner', limiter(20), async c => {
    const owner = c.req.param('owner');
    if (!nearAccountOk(owner)) return bad(c, 'not a NEAR account');
    const board = MAINNET_DEP?.board?.contract;
    if (!board) return c.json({ error: 'no board' }, 404);
    const fresh = c.req.query('fresh') === '1';
    try {
      const row = await view(board, 'get_charter', { owner }, cfg.rpc, { fresh });
      if (fresh) c.header('Cache-Control', 'no-store');
      return c.json({ owner, board, row: row || null, fresh });
    } catch (e) {
      if (/does not exist|UNKNOWN|MethodNotFound|not found|no charter/i.test(String(e.message))) return c.json({ owner, board, row: null, fresh });
      throw e;
    }
  });
  app.get('/api/account/:id', limiter(20), async c => {
    const id = c.req.param('id');
    if (!nearAccountOk(id)) return bad(c, 'not a NEAR account');
    try {
      const v = await viewAccount(id);
      return c.json({ id, exists: true, code_hash: v?.code_hash || null });
    } catch (e) {
      if (/UNKNOWN_ACCOUNT|does not exist/i.test(String(e.message))) return c.json({ id, exists: false, code_hash: null });
      return c.json({ error: 'the account check did not answer' }, 502);
    }
  });
  app.get('/api/tx-status/:hash', limiter(20), async c => {
    const hash = c.req.param('hash');
    const sender = c.req.query('sender') || '';
    if (!HASH.test(hash) || !nearAccountOk(sender)) return bad(c, 'need a tx hash and ?sender=');
    try {
      const body = await txStatus(hash, sender);
      const v = txVerdict(body);
      const final = body?.final_execution_status === 'FINAL' || !!body?.status;
      return c.json({ hash, sender, pass: v.pass, why: v.why, final });
    } catch (e) {
      return c.json({ hash, sender, pass: false, why: String(e.message || 'no status').slice(0, 160), final: false });
    }
  });
  app.get('/api/guardhouse/board', limiter(20), async c => {
    const owner = c.req.query('owner') || '';
    const payee = c.req.query('payee') || '';
    if (!ACCT.test(owner) || !ACCT.test(payee)) return bad(c, 'owner and payee must be account ids');
    try { return c.json(await previewOwner(owner, payee)); }
    catch (e) { return c.json({ error: e.message }, e.status || 502); }
  });
  // The town's own feed (the guardhouse oath), so a page can ask for it without reading /api/deployments first.
  // Public ledger (/ledger): sales, payouts, refusals and today's inference cost, from the same live reads.
  // Shared stale-while-revalidate in the process, and a short edge cache, so a room that also reads it
  // does not re-run the chain reads. limiter(20) is per client; the shared copy absorbs the fan-out.
  app.get('/api/ledger', limiter(60), edgeCache(15), async c => c.json(await ledgerSwr()));
  app.get('/api/chronicle', limiter(120), edgeCache(15), async c => c.json(mainnetChronicle(c.req.query('owner') || '')));
  app.get('/api/chronicle/live', limiter(30), async c => {
    const account = String(c.req.query('account') || '').trim();
    if (!nearAccountOk(account)) return bad(c, 'account must be a NEAR account id');
    const cursor = c.req.query('cursor');
    const ftCursor = c.req.query('ftCursor');
    const more = cursor != null || ftCursor != null;
    try { return c.json(await readLive(account, { cursor: cursor || '', ftCursor: ftCursor || '', more })); }
    catch (e) {
      return c.json({ account, live: false, rows: [], gaps: [String(e.message || 'Live read failed.').slice(0, 160)], sources: [], label: 'No rows for this account. The live timeline did not answer.' });
    }
  });
  app.post('/api/chronicle/statement', limiter(8), async c => {
    const b = await jsonBody(c);
    const account = String(b?.account || '').trim();
    if (!nearAccountOk(account)) return bad(c, 'account must be a NEAR account id');
    const rows = Array.isArray(b?.rows) ? b.rows.slice(0, 40) : [];
    const out = await signStatement({ account, period: b?.period || {}, rows, totals: b?.totals || null });
    return c.json(out);
  });
  // The anchors and rule versions this account wrote. Read-only rebuild from its own txs:
  // the board stores neither (anchor logs one event; set_rules overwrites the row).
  app.get('/api/chronicle/anchors', limiter(30), async c => {
    const account = String(c.req.query('account') || '').trim();
    if (!nearAccountOk(account)) return bad(c, 'account must be a NEAR account id');
    try {
      const listed = await accountTxHashes(account);
      const sender = account;
      const txs = [];
      for (const h of (listed.hashes || []).slice(0, 20)) {
        try { txs.push(await txStatus(h, sender)); } catch { /* one missing tx is a gap, not a failed rebuild */ }
      }
      const body = await anchorIndex({ account, txs });
      return c.json({ ...body, index: { source: listed.source, hashes: (listed.hashes || []).length, gap: listed.gap || '' } });
    } catch (e) {
      return c.json({ account, anchors: [], ruleWrites: [], gaps: [String(e.message || 'The rebuild did not answer.').slice(0, 160)] }, 200);
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
  // Mist Bank: live hardware attestation, plus an envelope check when the body carries a receipt.
  // Neither route refuses just because completions are off. The download has hashes and the summary.
  app.get('/api/bank/proof', limiter(6), nearAi, async c => c.json(await bankProof.bankProve({ enabled: false })));
  app.post('/api/bank/prove', limiter(6), nearAi, async c => {
    let body = {};
    const text = await c.req.text();
    if (text) { try { body = JSON.parse(text); } catch { return bad(c, 'body'); } }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad(c, 'body');
    return c.json(await bankProof.bankProve({ receipt: body.receipt || null }));
  });
  // Cap conversion only. The statement is not sent here.
  app.get('/api/bank/rate', limiter(12), async c => c.json(await bankRate.nearRate(c.req.query('currency') || '')));
  // One TEE audit completion. The rows are not stored and are not returned.
  app.post('/api/bank/audit', limiter(4), nearAi, async c => {
    let body = {};
    const text = await c.req.text();
    if (text) { try { body = JSON.parse(text); } catch { return bad(c, 'body'); } }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad(c, 'body');
    const model = typeof body.model === 'string' ? body.model.slice(0, 120) : '';
    return c.json(await bankModel.runModelAudit({ rows: body.rows, ...(model ? { model } : {}) }));
  });
  // Charters (factory) and Vault Arena: backend/src/vault.js
  vault.register(app, { limiter, globalCap });
  return app;
}
