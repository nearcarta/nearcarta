// HTTP protections for the public API: real client IP, per-route and global quotas, a leak guard.

// The client IP comes from a header that a proxy we can identify OVERWRITES, never from one the client types.
// Render sits behind Cloudflare: CF-Connecting-IP / True-Client-IP are the address that connected to it
// (a client cannot set them: Cloudflare answers error 1000). Render appends to X-Forwarded-For, so its first
// entry is client-controlled and never used.
// The site calls the API through Vercel (middleware.js rewrites /api/* and adds x-nearcarta-proxy from the
// Vercel env NC_PROXY_SECRET), so for those requests CF-Connecting-IP is a Vercel
// egress address shared by many visitors. Vercel overwrites X-Vercel-Forwarded-For with the visitor's IP
// (measured: a client-sent value is replaced). A client that calls Render directly can type that header,
// though. So:
//   * verified proxy (env PROXY_SECRET set and header x-nearcarta-proxy matches, timing-safe): the visitor IP
//     from X-Vercel-Forwarded-For is the key, with no other limit.
//   * secret set, header missing or wrong: X-Vercel-Forwarded-For is ignored; CF-Connecting-IP is the key.
//   * no secret configured (local or a fresh deploy only): the claimed visitor IP is the key AND the real connecting address (CF-Connecting-IP) gets
//     its own bucket at EGRESS_MULT x the quota. Faking visitor IPs then buys at most EGRESS_MULT x one quota.
import { timingSafeEqual } from 'node:crypto';
export const onRender = env => Boolean(env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_INSTANCE_ID);
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/, IPV6 = /^[0-9a-f:]{2,39}$/i;
export const isIp = v => Boolean(v) && (IPV4.test(v) || (v.includes(':') && IPV6.test(v)));
export const EGRESS_MULT = 20;
export function proxyVerified(c, env = process.env) {
  const want = env.PROXY_SECRET, got = c.req.header('x-nearcarta-proxy');
  if (!want || want.length < 32 || !got) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}
// Returns [source, key, egressKeyOrNull].
export function clientIdentity(c, env = process.env) {
  const h = n => c.req.header(n)?.trim() || null;
  if (onRender(env)) {
    let edge = null;
    for (const n of ['cf-connecting-ip', 'true-client-ip']) if (h(n)) { edge = [n, h(n)]; break; }
    const vff = h('x-vercel-forwarded-for');
    const strict = Boolean(env.PROXY_SECRET && env.PROXY_SECRET.length >= 32);
    if (isIp(vff) && proxyVerified(c, env)) return ['x-vercel-forwarded-for (verified proxy)', vff, null];
    // With the secret set, an unverified X-Vercel-Forwarded-For is ignored: the connecting address is the key.
    if (isIp(vff) && !strict) {
      return ['x-vercel-forwarded-for (capped per connecting ip)', vff, edge ? `egress:${edge[1]}` : 'egress:unknown'];
    }
    return edge ? [edge[0], edge[1], null] : ['render:unknown', 'render:unknown', null];
  }
  if (env.VERCEL) return h('x-real-ip') ? ['x-real-ip', h('x-real-ip'), null] : ['vercel:unknown', 'vercel:unknown', null];
  const sock = c.env?.incoming?.socket?.remoteAddress; // @hono/node-server
  return ['socket', sock || 'local', null];
}
export const clientIpSource = (c, env = process.env) => clientIdentity(c, env).slice(0, 2);
export const clientIp = (c, env = process.env) => clientIdentity(c, env)[1];

const MAX_KEYS = 20000;
function bucket(store, key, max, windowMs, now) {
  if (store.size > MAX_KEYS) store.clear(); // bounded memory; a flood resets counts, not the process
  const arr = (store.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { store.set(key, arr); return Math.ceil((windowMs - (now - arr[0])) / 1000); }
  arr.push(now); store.set(key, arr); return 0;
}

// Per-route, per-client quota. One instance per route, so each route has its own counter.
export function limiter(max, windowMs = 60e3, { ip, identity = clientIdentity, now = Date.now } = {}) {
  const hits = new Map();
  return async (c, next) => {
    const [, key, egress] = ip ? [null, ip(c), null] : identity(c);
    const t = now();
    const wait = (egress && bucket(hits, egress, max * EGRESS_MULT, windowMs, t)) || bucket(hits, key, max, windowMs, t);
    if (wait) { c.header('Retry-After', String(wait)); return c.json({ error: 'rate limited' }, 429); }
    return next();
  };
}

// Read-only answers the Vercel edge may keep for a few seconds: a judging room behind one IP then shares one copy.
export const edgeCache = (s = 15) => async (c, next) => { await next(); if (c.res?.status === 200 && !c.res.headers.get('Cache-Control')) c.res.headers.set('Cache-Control', `public, max-age=5, s-maxage=${s}, stale-while-revalidate=${s * 4}`); };

// Global cap shared by every client: protects the paid 1Click partner key and NEAR AI key.
const globals = new Map();
export function globalCap(name, max, windowMs = 60e3, { now = Date.now } = {}) {
  if (!globals.has(name)) globals.set(name, new Map());
  const store = globals.get(name);
  return async (c, next) => {
    const wait = bucket(store, name, max, windowMs, now());
    if (wait) { c.header('Retry-After', String(wait)); return c.json({ error: 'busy, try again later' }, 503); }
    return next();
  };
}
export const _resetGlobals = () => globals.clear();

// Defence in depth: no API response may carry a viewing key or a commitment opening.
const LEAK = /uview(test)?1[0-9a-z]{20,}|salt=[0-9a-f]{16,}|"zats"\s*:/;
export const leakGuard = async (c, next) => {
  await next();
  if (!c.res.headers.get('content-type')?.includes('json')) return;
  const body = await c.res.clone().text();
  if (LEAK.test(body)) { console.error('leak guard blocked a response on', c.req.path); c.res = c.json({ error: 'internal' }, 500); }
};

// Errors: our own validation errors (4xx) keep their message; anything else is generic.
// Upstream overload (every RPC endpoint answered 429/5xx or timed out) is not our bug: say 503 + Retry-After.
export const OVERLOAD = /http (429|5\d\d)\b|timeout|aborted|fetch failed|ECONNRESET/i;
export function onError(e, c) {
  const s = Number(e.status) || 500;
  if (s >= 400 && s < 500) return c.json({ error: e.message }, s);
  if (!e.status && OVERLOAD.test(String(e.message))) {
    console.error(c.req.method, c.req.path, e.message);
    c.header('Retry-After', '3');
    return c.json({ error: 'rpc busy, retry shortly', retry: true }, 503);
  }
  console.error(c.req.method, c.req.path, e.message);
  return c.json({ error: s === 503 ? 'unavailable' : s === 502 ? 'upstream error' : 'internal' }, s >= 500 && s < 600 ? s : 500);
}

export const DEFAULT_ORIGINS = ['https://nearcarta.vercel.app', 'http://localhost:8787', 'http://127.0.0.1:8787', 'http://localhost:5173'];
export const allowedOrigins = (v = process.env.CORS_ORIGIN) =>
  (!v || v.trim() === '*') ? DEFAULT_ORIGINS : v.split(',').map(s => s.trim()).filter(Boolean);
// Vercel preview deployments of this project only (team scope jol5): nearcarta-<hash>-jol5.vercel.app
// and nearcarta-git-<branch>-jol5.vercel.app. Another team's project cannot get a hostname ending in -jol5.
export const PREVIEW_ORIGIN = /^https:\/\/nearcarta-[a-z0-9-]{1,80}-jol5\.vercel\.app$/;
export const corsOrigin = (list = allowedOrigins()) => origin =>
  (list.includes(origin) || PREVIEW_ORIGIN.test(origin || '')) ? origin : null;
