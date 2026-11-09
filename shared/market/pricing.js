// Market Day pricing, the JavaScript copy used by fast-forward and the tooltip.
// The rule itself lives in contracts/arena_v2/src/pricing.rs. This file repeats
// the same integer steps with BigInt; shared/market/pricing-cases.json pins both.
export const ONE = 10_000n;
const SCARCITY_MIN = 2_500n, SCARCITY_MAX = 40_000n;
const DEMAND_STEP = 500n, DEMAND_MIN = 5_000n, DEMAND_MAX = 20_000n;
const MOOD_SHORT = 9_000n, SELL_SHARE = 8_000n;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const big = (v) => BigInt(v);

export function scarcityBps(stock, target) {
  const s = (big(target) * ONE) / (big(stock) > 0n ? big(stock) : 1n);
  return clamp(s, SCARCITY_MIN, SCARCITY_MAX);
}

export function demandBps(buys, sells) {
  return clamp(ONE + (big(buys) - big(sells)) * DEMAND_STEP, DEMAND_MIN, DEMAND_MAX);
}

export function moodBps(till, floor) {
  return big(till) < big(floor) ? MOOD_SHORT : ONE;
}

// market: { base, stock, target_stock, buys_last_hour, sells_last_hour, till, floor }
// base, till and floor are yoctoNEAR strings, as the contract's U128 JSON.
export function quote(market) {
  const s = scarcityBps(market.stock, market.target_stock);
  const d = demandBps(market.buys_last_hour, market.sells_last_hour);
  const o = moodBps(market.till, market.floor);
  const buy = (((big(market.base) * s) / ONE) * d / ONE) * o / ONE;
  const sell = (buy * SELL_SHARE) / ONE;
  return {
    buy: buy.toString(),
    sell: sell.toString(),
    reasons: [
      { rule: 'scarcity', factor_bps: Number(s), why: `${market.stock} in stock, target ${market.target_stock}` },
      { rule: 'demand', factor_bps: Number(d), why: `${market.buys_last_hour} bought, ${market.sells_last_hour} sold in the last hour` },
      { rule: 'mood', factor_bps: Number(o), why: o < ONE ? 'till below floor, selling cheaper to raise cash' : 'till above floor' },
    ],
  };
}
