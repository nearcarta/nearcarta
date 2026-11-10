// GET /api/market/live: the market as the chain has it. Shops, prices and stock from the market contract,
// each keeper's own wallet (purse) and board row. Cached for 15 seconds; reads only.
import { view, viewAccount } from './near.js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

const TTL = 15_000;
let cache = { at: 0, body: null, pending: null };
const BYTE = 10n ** 19n;

export async function readLive({ viewF = view, accountF = viewAccount } = {}) {
  const market = MAIN.market?.contract, board = MAIN.board?.contract;
  const keepers = MAIN.keepers?.accounts || {};
  const [shops, orders] = await Promise.all([viewF(market, 'market_board', {}), viewF(market, 'orders', { from_index: 0, limit: 20 }).catch(() => [])]);
  const k = {};
  await Promise.all(Object.entries(keepers).map(async ([shop, rec]) => {
    const [a, row] = await Promise.all([accountF(rec.account).catch(() => null), viewF(board, 'get_charter', { owner: rec.account }).catch(() => null)]);
    const purse = a ? BigInt(a.amount) - BigInt(a.storage_usage) * BYTE : 0n;
    k[shop] = { account: rec.account, purse: String(purse > 0n ? purse : 0n), row: row ? { balance: row.balance, actions_today: row.actions_today, spent_today: row.spent_today } : null };
  }));
  return {
    market, board, fetched_at: new Date().toISOString(),
    shops: (shops || []).map(s => ({ id: s.id, keeper: s.keeper, open: s.open, till: s.till, floor: s.floor, trades: s.trades, shares: s.shares, owed: s.owed,
      goods: (s.goods || []).map(g => ({ good: g.good, stock: g.stock, buy: g.quote?.buy, sell: g.quote?.sell })) })),
    keepers: k, orders: Array.isArray(orders) ? orders : [],
  };
}

export async function live(deps) {
  const now = Date.now();
  if (cache.body && now - cache.at < TTL) return cache.body;
  if (!cache.pending) cache.pending = readLive(deps).then(b => { cache = { at: Date.now(), body: b, pending: null }; return b; }, e => { cache.pending = null; throw e; });
  return cache.pending;
}
export const _reset = () => { cache = { at: 0, body: null, pending: null }; };

export function register(app, { limiter }) {
  app.get('/api/market/live', limiter(60), async c => {
    try { return c.json(await live()); } catch (e) { return c.json({ error: 'market read failed' }, 502); }
  });
}
