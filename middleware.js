// Adds a per-request CSP nonce to every HTML page (see csp.mjs).
import { policy, nonce, withNonce } from './csp.mjs';

export const config = { matcher: ['/', '/((?!api/).*\\.html)', '/((?!api/)[^.]*)'] };

const pass = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

export default async function middleware(req) {
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
