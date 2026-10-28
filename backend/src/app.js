// HTTP API (Hono). Read-only on chain; quotes are dry; no route can sign or spend.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { DEP, cfg, has } from './config.js';
import * as ferry from './ferry.js';
import { zcashRecipient } from './zcash.js';
import * as guard from './guardhouse.js';
import * as mist from './mistbank.js';
import * as shops from './shops.js';
import * as ai from './ai.js';
import * as tee from './tee.js';

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const knownAccounts = new Set([DEP.guardhouse.oath, DEP.townhall.oath, DEP.townhall.dao, DEP.arena.contract, DEP.toll.oath]);

function limiter(max, windowMs) {
  const hits = new Map();
  return async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';
    const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return c.json({ error: 'rate limited' }, 429);
    arr.push(now); hits.set(ip, arr); return next();
  };
}

export function makeApp() {
  const app = new Hono();
  app.use('/api/*', cors({ origin: cfg.corsOrigin }));
  app.onError((e, c) => c.json({ error: e.message }, e.status || 500));

  app.get('/api/health', async c => c.json({ ok: true, network: DEP.network, near: await shops.health(),
    features: { confidentialQuotes: has.oneClick(), nearAi: has.nearAi(), signing: false } }));
  app.get('/api/deployments', c => c.json(DEP));

  // Ferry
  app.get('/api/ferry/tokens', async c => {
    const list = await ferry.tokens();
    return c.json(list.map(t => ({ assetId: t.assetId, symbol: t.symbol, chain: t.blockchain, decimals: t.decimals, price: t.price })));
  });
  app.post('/api/ferry/quote', limiter(20, 60e3), async c => {
    const b = await c.req.json();
    for (const k of ['from', 'to', 'amount', 'recipient', 'refundTo']) if (!b[k]) return c.json({ error: `missing ${k}` }, 400);
    return c.json(await ferry.quote({ from: b.from, to: b.to, amount: b.amount, recipient: b.recipient, refundTo: b.refundTo,
      privacy: b.privacy || 'public', slippageBps: Number(b.slippageBps || 100) }));
  });
  app.get('/api/ferry/zcash/:addr', c => {
    try { return c.json(zcashRecipient(c.req.param('addr'))); } catch (e) { return c.json({ error: e.message }, 400); }
  });

  // Guardhouse
  app.get('/api/guardhouse', async c => c.json(await guard.snapshot()));
  app.get('/api/guardhouse/action/:id', async c => c.json(await guard.action(c.req.param('id'))));

  // Other shops
  app.get('/api/mistbank', limiter(20, 60e3), async c => c.json(await mist.mistbank()));
  app.get('/api/mistbank/street/:txid', limiter(20, 60e3), async c => c.json(mist.streetCheck(await mist.fetchStreet(c.req.param('txid')))));
  app.get('/api/townhall', async c => c.json(await shops.townhall()));
  app.get('/api/arena', async c => c.json(await shops.arena()));
  app.get('/api/toll', async c => c.json(await shops.toll()));
  app.get('/api/chronicle/:account', limiter(30, 60e3), async c => {
    const a = c.req.param('account');
    if (!knownAccounts.has(a)) return c.json({ error: 'not a Nearcarta contract' }, 400);
    return c.json(await shops.chronicle(a, Math.min(Number(c.req.query('limit') || 8), 15)));
  });
  app.get('/api/tx/:hash', async c => {
    const h = c.req.param('hash'), s = c.req.query('sender');
    if (!HASH.test(h) || !s || !ACCT.test(s)) return c.json({ error: 'need tx hash and ?sender=' }, 400);
    return c.json(await shops.explainAny(h, s));
  });

  // NEAR AI Cloud
  app.get('/api/ai/attestation', limiter(10, 60e3), async c => c.json(await ai.attestation(cfg.nearAiModel)));
  // Full TEE preflight (dcap-qvl quote, nonce + signer binding, MRCONFIGID, RTMR3 replay, NVIDIA NRAS).
  // Non-billable. ?nonce= lets the caller supply its own 32-byte hex nonce.
  app.get('/api/ai/tee', limiter(6, 60e3), async c => c.json(await tee.proveTee({ nonce: c.req.query('nonce') || undefined })));
  app.post('/api/ai/prove', limiter(3, 60e3), async c => {
    // Completions are billable. Off unless AI_PROVE_ENABLED=1 (the account currently has no credits: HTTP 402).
    if (process.env.AI_PROVE_ENABLED !== '1') return c.json({ error: 'completions disabled on this deployment (AI_PROVE_ENABLED!=1)' }, 403);
    return c.json(await ai.prove());
  });
  return app;
}
