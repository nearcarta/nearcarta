// GET /api/market/history: the market's real history for the fast-forward. One page of the public
// transaction index (the calls the market contract received), turned into plain lines by
// shared/market/replay.js. Cached for a minute; reads only.
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };
import { replay } from '../../shared/market/replay.js';

const TTL = 60_000;
let cache = { at: 0, body: null };

export async function history({ fetchF = fetch, now = Date.now } = {}) {
  if (cache.body && now() - cache.at < TTL) return cache.body;
  const market = MAIN.market.contract;
  const key = process.env.NEARBLOCKS_API_KEY || '';
  const r = await fetchF(`https://api.nearblocks.io/v1/account/${market}/txns?per_page=50`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('index ' + r.status);
  const j = await r.json();
  const events = replay(j.txns || []);
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
