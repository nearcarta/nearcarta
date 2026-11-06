// Local static host for app/dist with the same rewrite as vercel.json, plus /api proxy to the backend.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { policy, nonce, withNonce } from '../csp.mjs';
const root = new URL('./dist', import.meta.url).pathname;
const api = process.env.API_ORIGIN || 'http://127.0.0.1:8787';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
export const REWRITES = { '/design/D6_dashboards/src/data.js': '/live/data.js', '/console': '/console.html', '/ledger': '/ledger.html', '/loop': '/loop.html', '/ferry-widget': '/ferry-widget.html' };
createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b)); });
    try {
      const r = await fetch(api + u.pathname + u.search, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json' }, body });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' }); return res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'api down' })); }
  }
  if (/^\/pay\/[A-Za-z0-9_]+$/.test(u.pathname)) {
    u.pathname = '/pay/index.html';
  }
  if (/^\/shops\/[a-z0-9-]+$/.test(u.pathname)) {
    res.writeHead(308, { location: u.pathname + '/' + u.search });
    return res.end();
  }
  let p = decodeURIComponent(REWRITES[u.pathname] || u.pathname);
  let f = normalize(join(root, p)); if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { if ((await stat(f)).isDirectory()) f = join(f, 'index.html'); const b = await readFile(f);
    if (extname(f) === '.html') { const n = nonce(); res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': policy(n) }); return res.end(withNonce(b.toString(), n)); }
    res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); res.end(b);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(Number(process.env.PORT || 5173), () => console.log('app on', process.env.PORT || 5173));
