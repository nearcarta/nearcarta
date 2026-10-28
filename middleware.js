// Adds a per-request CSP nonce to every HTML page (see csp.mjs), and sends /api/* to the Render API with
// a proxy header (x-nearcarta-proxy = Vercel env NC_PROXY_SECRET, a Secret-type value never sent to the browser).
// Render trusts the visitor IP in X-Vercel-Forwarded-For only when that header matches its PROXY_SECRET
// (backend/src/http-guard.js). Without the env value, the vercel.json rewrite carries /api/* as before.
import { policy, nonce, withNonce } from './csp.mjs';

export const config = { matcher: ['/', '/api/:path*', '/((?!api/).*\\.html)', '/((?!api/)[^.]*)'] };
const API = 'https://nearcarta-api.onrender.com';

function toApi(req, u, secret) {
  const h = new Headers({ 'x-middleware-rewrite': API + u.pathname + u.search });
  const keys = [];
  for (const [k, v] of req.headers) if (k !== 'x-nearcarta-proxy') { h.set('x-middleware-request-' + k, v); keys.push(k); }
  h.set('x-middleware-request-x-nearcarta-proxy', secret); keys.push('x-nearcarta-proxy');
  h.set('x-middleware-override-headers', keys.join(','));
  return new Response(null, { headers: h });
}

const pass = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

export default async function middleware(req) {
  if (new URL(req.url).pathname.startsWith('/api/')) {
    const secret = process.env.NC_PROXY_SECRET;
    return secret ? toApi(req, new URL(req.url), secret) : pass();
  }
  if (req.headers.get('x-nc-inner') || !['GET', 'HEAD'].includes(req.method)) return pass();
  const u = new URL(req.url);
  const p = u.pathname;
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
