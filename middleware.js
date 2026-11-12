// Adds a per-request CSP nonce to every HTML page (see csp.mjs), and sends /api/* to the Render API with
// a proxy header (x-nearcarta-proxy = Vercel env NC_PROXY_SECRET, a Secret-type value never sent to the browser).
// Render trusts the visitor IP in X-Vercel-Forwarded-For only when that header matches its PROXY_SECRET
// (backend/src/http-guard.js). Without the env value, the vercel.json rewrite carries /api/* as before.
import { policy, nonce, withNonce } from './csp.mjs';

export const config = { matcher: ['/', '/api/:path*', '/tapi/:path*', '/((?!api/|tapi/).*\\.html)', '/((?!api/|tapi/)[^.]*)'] };
const API = 'https://nearcarta-api.onrender.com';
// The testnet service. /tapi/* is the same API on the guest network, so one page can talk to each.
const API_TESTNET = 'https://nearcarta-api-testnet.onrender.com';

function toApi(req, u, secret, base = API, strip = '') {
  const path = strip ? u.pathname.replace(strip, '/api') : u.pathname;
  const h = new Headers({ 'x-middleware-rewrite': base + path + u.search });
  const keys = [];
  for (const [k, v] of req.headers) if (k !== 'x-nearcarta-proxy') { h.set('x-middleware-request-' + k, v); keys.push(k); }
  h.set('x-middleware-request-x-nearcarta-proxy', secret); keys.push('x-nearcarta-proxy');
  h.set('x-middleware-override-headers', keys.join(','));
  return new Response(null, { headers: h });
}

const pass = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

export default async function middleware(req) {
  const path = new URL(req.url).pathname;
  if (path.startsWith('/api/')) {
    const secret = process.env.NC_PROXY_SECRET;
    return secret ? toApi(req, new URL(req.url), secret) : pass();
  }
  // /tapi/* is the testnet API. The proxy maps /tapi/x to /api/x on the testnet service.
  if (path.startsWith('/tapi/')) {
    const secret = process.env.NC_PROXY_SECRET;
    return secret ? toApi(req, new URL(req.url), secret, API_TESTNET, '/tapi') : pass();
  }
  if (req.headers.get('x-nc-inner') || !['GET', 'HEAD'].includes(req.method)) return pass();
  const u = new URL(req.url);
  const p = u.pathname;
  // /shops/payouts (no slash) is the folder index. A relative bundle then loads from /shops/ and never runs.
  if (/^\/shops\/[a-z0-9-]+$/.test(p)) {
    const dest = new URL(req.url);
    dest.pathname = p + '/';
    return Response.redirect(dest, 308);
  }
  const tries = p.endsWith('/') ? [p + 'index.html'] : p.endsWith('.html') ? [p] : [p + '.html', p + '/index.html'];
  for (const t of tries) {
    const r = await fetch(new URL(t + u.search, u), { headers: { 'x-nc-inner': '1' } });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('text/html')) continue;
    const n = nonce();
    const h = new Headers(r.headers);
    h.set('content-security-policy', policy(n));
    h.set('cache-control', 'no-store');
    h.delete('content-length'); h.delete('content-encoding'); h.delete('etag');
    return new Response(withNonce(await r.text(), n), { status: 200, headers: h });
  }
  return pass();
}
