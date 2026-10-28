// HTTP protections for the public API: real client IP, per-route and global quotas, a leak guard.

// The client IP comes from the header the platform's edge OVERWRITES, never from a header the
// client can type. Render sits behind Cloudflare: CF-Connecting-IP / True-Client-IP are set by the
// edge. Render appends to X-Forwarded-For instead of replacing it, so its first entry is
// client-controlled and is never used. Vercel sets x-real-ip itself. Locally: the socket address.
export const onRender = env => Boolean(env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_INSTANCE_ID);
export function clientIpSource(c, env = process.env) {
  const h = n => c.req.header(n)?.trim() || null;
  if (onRender(env)) {
    for (const n of ['cf-connecting-ip', 'true-client-ip']) if (h(n)) return [n, h(n)];
    return ['render:unknown', 'render:unknown'];
  }
  if (env.VERCEL) return h('x-real-ip') ? ['x-real-ip', h('x-real-ip')] : ['vercel:unknown', 'vercel:unknown'];
  const sock = c.env?.incoming?.socket?.remoteAddress; // @hono/node-server
  return ['socket', sock || 'local'];
}
export const clientIp = (c, env = process.env) => clientIpSource(c, env)[1];

const MAX_KEYS = 20000;
function bucket(store, key, max, windowMs, now) {
  if (store.size > MAX_KEYS) store.clear(); // bounded memory; a flood resets counts, not the process
  const arr = (store.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { store.set(key, arr); return Math.ceil((windowMs - (now - arr[0])) / 1000); }
  arr.push(now); store.set(key, arr); return 0;
}

// Per-route, per-client quota. One instance per route, so each route has its own counter.
export function limiter(max, windowMs = 60e3, { ip = clientIp, now = Date.now } = {}) {
  const hits = new Map();
  return async (c, next) => {
    const wait = bucket(hits, ip(c), max, windowMs, now());
    if (wait) { c.header('Retry-After', String(wait)); return c.json({ error: 'rate limited' }, 429); }
    return next();
  };
}

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
export function onError(e, c) {
  const s = Number(e.status) || 500;
  if (s >= 400 && s < 500) return c.json({ error: e.message }, s);
  console.error(c.req.method, c.req.path, e.message);
  return c.json({ error: s === 503 ? 'unavailable' : s === 502 ? 'upstream error' : 'internal' }, s >= 500 && s < 600 ? s : 500);
}

export const DEFAULT_ORIGINS = ['https://nearcarta.vercel.app', 'http://localhost:8787', 'http://127.0.0.1:8787', 'http://localhost:5173'];
export const allowedOrigins = (v = process.env.CORS_ORIGIN) =>
  (!v || v.trim() === '*') ? DEFAULT_ORIGINS : v.split(',').map(s => s.trim()).filter(Boolean);
