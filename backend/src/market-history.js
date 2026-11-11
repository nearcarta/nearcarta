// GET /api/market/history: the market's real history for the fast-forward. One page of the public
// transaction index (the calls the market contract received), turned into plain lines by
// shared/market/replay.js. Cached for a minute; reads only.
import { DEP, cfg } from './config.js';
import { replay } from '../../shared/market/replay.js';
import { txRange, accountTxPath } from '../../shared/net/nearblocks.js';

const TTL = 60_000;
let cache = { at: 0, body: null };

export async function history({ fetchF = fetch, now = Date.now } = {}) {
  if (cache.body && now() - cache.at < TTL) return cache.body;
  const market = DEP.market?.contract || DEP.planned?.arena || '';
  const key = process.env.NEARBLOCKS_API_KEY || '';
  // Testnet answers v3 only; the adapter turns either version into the v1 rows `replay` reads.
  const apiBase = (process.env.NEARBLOCKS_API || cfg.explorerApi).replace(/\/$/, '');
  const path = accountTxPath(apiBase, market, { v3: cfg.explorerApiV3 === true, limit: 50 });
  const r = await fetchF(path, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('index ' + r.status);
  const j = await r.json();
  const events = replay(txRange(j));
  const body = { market, source: 'nearblocks', fetched_at: new Date(now()).toISOString(), events };
  cache = { at: now(), body };
  return body;
}
export const _reset = () => { cache = { at: 0, body: null }; };

export function register(app, { limiter }) {
  app.get('/api/market/history', limiter(30), async (c) => {
    try { return c.json(await history()); } catch { return c.json({ error: 'history unavailable' }, 502); }
  });
}
