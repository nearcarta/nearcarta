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
import { view } from './near.js';
import { limiter, clientIpSource, globalCap, leakGuard, onError, allowedOrigins } from './http-guard.js';

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const knownAccounts = new Set([DEP.guardhouse.oath, DEP.townhall.oath, DEP.townhall.dao, DEP.arena.contract, DEP.toll.oath]);
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

  app.get('/api/health', limiter(60), async c => c.json({ ok: true, client_ip_from: clientIpSource(c)[0], network: DEP.network, near: await shops.health(),
    features: { confidentialQuotes: has.oneClick(), nearAi: has.nearAi(), signing: false } }));
  app.get('/api/deployments', limiter(30), c => c.json(DEP));

  // Ferry
  app.get('/api/ferry/tokens', limiter(30), async c => {
    const list = await ferry.tokens();
    return c.json(list.map(t => ({ assetId: t.assetId, symbol: t.symbol, chain: t.blockchain, decimals: t.decimals, price: t.price })));
  });
  app.post('/api/ferry/quote', limiter(10), oneClick, async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    for (const k of ['from', 'to', 'amount', 'recipient', 'refundTo']) if (!str(b[k], 300)) return bad(c, `missing or bad ${k}`);
    if (b.privacy !== undefined && !['public', 'basic', 'advanced'].includes(b.privacy)) return bad(c, 'privacy must be public|basic|advanced');
    if (b.slippageBps !== undefined && !(Number.isInteger(Number(b.slippageBps)) && Number(b.slippageBps) >= 0 && Number(b.slippageBps) <= 1000)) return bad(c, 'slippageBps must be 0..1000');
    return c.json(await ferry.quote({ from: b.from, to: b.to, amount: b.amount, recipient: b.recipient, refundTo: b.refundTo,
      privacy: b.privacy || 'public', slippageBps: Number(b.slippageBps || 100) }));
  });
  app.get('/api/ferry/zcash/:addr', limiter(30), c => {
    try { return c.json(zcashRecipient(c.req.param('addr'))); } catch { return bad(c, 'not a valid Zcash address'); }
  });

  // Guardhouse
  app.get('/api/guardhouse', limiter(30), async c => c.json(await guard.snapshot()));
  // Your House: a second charter on the same wasm, governed by its owner's wallet (no DAO).
  app.get('/api/house', limiter(20), async c => {
    const H = DEP.house; if (!H) return c.json({ error: 'no house' }, 404);
    const [snap, pending] = await Promise.all([guard.snapshot(H.oath), view(H.oath, 'get_pending')]);
    // get_pending is queued policy changes; held agent spends are actions with status "escalated", so read the latest few.
    const next = Number(snap.state.next_action || 0), actions = {};
    await Promise.all(Array.from({ length: Math.min(next, 8) }, (_, i) => String(next - 1 - i)).map(async id => { actions[id] = await guard.action(id, H.oath).catch(() => null); }));
    return c.json({ ...snap, owner: H.owner, dao: H.dao, code_hash: H.code_hash, pending, actions, proof_txs: H.proof_txs, demo: H.demo || null });
  });
  app.get('/api/guardhouse/action/:id', limiter(30), async c => {
    const id = c.req.param('id'); if (!/^\d{1,9}$/.test(id)) return bad(c, 'action id must be a number');
    return c.json(await guard.action(id));
  });

  // Other shops
  // The desk's 1Click calls are cached 60 s inside mist.mistbank(), so this route cannot drain the key.
  app.get('/api/mistbank', limiter(20), async c => c.json(await mist.mistbank()));
  // Auditor flow: the opening is POSTed (not in a URL, so not in access logs) and never echoed back.
  app.post('/api/mistbank/verify', limiter(10), async c => {
    const b = await jsonBody(c); if (!b) return bad(c, 'body must be a JSON object');
    return c.json(mist.verifyOpening(b.amount, b.salt));
  });
  app.get('/api/mistbank/verify', c => c.json({ error: 'POST {"amount":"<zatoshi>","salt":"<32 hex>"}; the opening is auditor-only and never goes in a URL' }, 405));
  app.get('/api/mistbank/street/:txid', limiter(10), async c => c.json(mist.streetCheck(await mist.fetchStreet(c.req.param('txid')))));
  app.get('/api/townhall', limiter(20), async c => c.json(await shops.townhall()));
  app.get('/api/arena', limiter(20), async c => c.json(await shops.arena()));
  app.get('/api/arena/attempts', limiter(20), async c => c.json(await shops.arenaAttempts(c.req.query('from'), c.req.query('limit'))));
  app.get('/api/toll', limiter(20), async c => c.json(await shops.toll()));
  app.get('/api/chronicle/:account', limiter(20), async c => {
    const a = c.req.param('account');
    if (!knownAccounts.has(a)) return c.json({ error: 'not a Nearcarta contract' }, 400);
    return c.json(await shops.chronicle(a, Math.min(Number(c.req.query('limit') || 8), 15)));
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
