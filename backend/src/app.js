// HTTP API (Hono). Read-only on chain; quotes are dry; no route can sign or spend.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { DEP, cfg, has } from './config.js';
import * as ferry from './ferry.js';
import { zcashRecipient } from './zcash.js';
import * as guard from './guardhouse.js';
import * as mist from './mistbank.js';
import * as shops from './shops.js';
import * as ai from './ai.js';
import * as tee from './tee.js';
import * as vault from './vault.js';
import { view, rpcStats } from './near.js';
import { limiter, clientIpSource, globalCap, leakGuard, onError, allowedOrigins, OVERLOAD } from './http-guard.js';

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
export const _resetLastGood = () => good.clear();

// One handler per public read route, shared by the routes and by /api/health?deep=1.
const reads = Object.fromEntries(Object.entries({
  guardhouse: () => guard.snapshot(),
  house: houseView,
  mistbank: () => mist.mistbank(),
  townhall: () => shops.townhall(),
  arena: () => shops.arena(),
  arena_attempts: () => shops.arenaAttempts(undefined, '2'),
  toll: () => shops.toll(),
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
const knownAccounts = new Set([DEP.guardhouse.oath, DEP.townhall.charter, DEP.townhall.dao, DEP.arena.contract, DEP.toll.oath].filter(Boolean));
const bad = (c, m) => c.json({ error: m }, 400);
async function jsonBody(c) {
  try { const b = await c.req.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; }
}
const str = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;

export function makeApp() {
  const app = new Hono();
  // Global caps (all clients together) on routes that spend a paid key: 1Click partner key, NEAR AI key.
  const oneClick = globalCap('1click', Number(process.env.CAP_1CLICK_PER_MIN || 60));
  const nearAi = globalCap('nearai', Number(process.env.CAP_NEARAI_PER_MIN || 12));
  app.use('/api/*', cors({ origin: allowedOrigins(), allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['content-type'], maxAge: 600 }));
  app.use('/api/*', secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    crossOriginResourcePolicy: 'cross-origin', referrerPolicy: 'no-referrer', strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  }));
  app.use('/api/*', bodyLimit({ maxSize: 16 * 1024, onError: c => c.json({ error: 'body too large' }, 413) }));
  app.use('/api/*', leakGuard);
  app.onError(onError);
  app.notFound(c => c.json({ error: 'not found' }, 404));

  // ?deep=1 runs every read route's handler (not the AI or quote routes, which spend credits) and reports
  // each one's status and time, plus the RPC retry/fallback/stale counters.
  app.get('/api/health', limiter(60), async c => c.json({ ...(c.req.query('deep') ? await deepHealth() : {}), ok: true, client_ip_from: clientIpSource(c)[0], network: DEP.network, near: await shops.health(),
    features: { confidentialQuotes: has.oneClick(), nearAi: has.nearAi(), signing: false }, vault_runner: await vault.runnerStatus() }));
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
  app.get('/api/ferry/zcash/:addr', limiter(30), c => {
    try { return c.json(zcashRecipient(c.req.param('addr'))); } catch { return bad(c, 'not a valid Zcash address'); }
  });

  // Guardhouse
  app.get('/api/guardhouse', limiter(30), async c => c.json(await reads.guardhouse()));
  // Your House: a second charter on the same wasm, governed by its owner's wallet (no DAO).
  app.get('/api/house', limiter(20), async c => { const h = await houseView(); return h ? c.json(h) : c.json({ error: 'no house' }, 404); });
  app.get('/api/guardhouse/action/:id', limiter(30), async c => {
    const id = c.req.param('id'); if (!/^\d{1,9}$/.test(id)) return bad(c, 'action id must be a number');
    return c.json(await guard.action(id));
  });

  // Other shops
  // The desk's 1Click calls are cached 60 s inside mist.mistbank(), so this route cannot drain the key.
  app.get('/api/mistbank', limiter(20), async c => c.json(await reads.mistbank()));
  // Auditor flow: the opening is POSTed (not in a URL, so not in access logs) and never echoed back.
  app.post('/api/mistbank/verify', limiter(10), async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    return c.json(mist.verifyOpening(b.amount, b.salt));
  });
  app.get('/api/mistbank/verify', c => c.json({ error: 'POST {"amount":"<zatoshi>","salt":"<32 hex>"}; the opening is auditor-only and never goes in a URL' }, 405));
  app.get('/api/mistbank/street/:txid', limiter(10), async c => c.json(mist.streetCheck(await mist.fetchStreet(c.req.param('txid')))));
  app.get('/api/townhall', limiter(20), async c => c.json(await reads.townhall()));
  app.get('/api/arena', limiter(20), async c => c.json(await reads.arena()));
  app.get('/api/arena/attempts', limiter(20), async c => c.json(await shops.arenaAttempts(c.req.query('from'), c.req.query('limit'))));
  app.get('/api/toll', limiter(20), async c => c.json(await reads.toll()));
  app.get('/api/chronicle/:account', limiter(20), async c => {
    const a = c.req.param('account');
    if (!knownAccounts.has(a)) return c.json({ error: 'not a Nearcarta contract' }, 400);
    return c.json(await shops.chronicle(a, Math.min(Number(c.req.query('limit') || 8), 15)));
  });
  // R16 oath charters: on-chain reputation (refusal buckets) and one clause's user-set rules. Read-only views;
  // older charters (R14/R15) have no such method and answer { supported: false }.
  const oathRead = (method, args) => async c => {
    const a = c.req.param('account');
    if (!ACCT.test(a)) return c.json({ error: 'not an account id' }, 400);
    try {
      const v = await view(a, method, args(c));
      if (v == null) return c.json({ error: 'no such clause' }, 404);
      return c.json({ account: a, supported: true, [method === 'get_reputation' ? 'reputation' : 'rules']: v });
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
  app.get('/api/ai/tee', limiter(4), nearAi, async c => {
    const model = c.req.query('model');
    if (model && (model.length > 120 || !(await tee.attestedModels()).attested.some(m => m.id === model))) return bad(c, 'that model has no TEE attestation; see /api/ai/tee/models');
    return c.json(await tee.proveTee({ nonce: c.req.query('nonce') || undefined, ...(model ? { model } : {}) }));
  });
  app.post('/api/ai/prove', limiter(3), nearAi, async c => {
    // Completions are billable. Off unless AI_PROVE_ENABLED=1 (the account currently has no credits: HTTP 402).
    if (process.env.AI_PROVE_ENABLED !== '1') return c.json({ error: 'completions disabled on this deployment (AI_PROVE_ENABLED!=1)' }, 403);
    return c.json(await ai.prove());
  });
  // Charters (factory) and Vault Arena: backend/src/vault.js
  vault.register(app, { limiter, globalCap });
  return app;
}
