// Market Day city simulation: the same rules as contracts/market, in JavaScript.
// Used for the practice round before a player signs in, and for fast-forward.
// Money is BigInt yocto. Prices come from ./pricing.js, the pinned mirror of pricing.rs.
// Nothing here sends a transaction.
import { quote } from './pricing.js';

export const MILLI = 10n ** 21n;
export const GATHER_S = 30;
export const MAX_QTY = 10;
export const TOOL_LIFE = 10;
export const DIVIDEND_BPS = 2_000n;
export const REPAY_BPS = 11_000n;
export const ACC = 1_000_000n;
export const HOUR_S = 3_600;
export const CITY_DAY_S = 20 * 60;

export const GOODS = {
  'good:iron': { name: 'Iron', base: 2n * MILLI, icon: 'ore' },
  'good:timber': { name: 'Timber', base: MILLI, icon: 'wood' },
  'good:herb': { name: 'Herbs', base: (3n * MILLI) / 2n, icon: 'herb' },
  'good:salt': { name: 'Salt', base: (6n * MILLI) / 5n, icon: 'salt' },
};
export const ITEMS = {
  'item:tool': { name: 'Tool', inputs: { 'good:iron': 2, 'good:timber': 1 }, use: '2 per gather, lasts 10' },
  'item:tonic': { name: 'Tonic', inputs: { 'good:herb': 2, 'good:salt': 1 }, use: 'Night orders want it' },
};
// Goods come from shops: each berth is a gather node named after the shop that produces it: [id, good, shop].
// On chain these are the market's `set_node` ids, so `gather(node: "ferry-1")` is "unload salt at the Ferry".
export const NODES = [
  ['ferry-1', 'good:salt', 'ferry'], ['ferry-2', 'good:salt', 'ferry'], ['ferry-3', 'good:salt', 'ferry'],
  ['house-1', 'good:herb', 'house'], ['house-2', 'good:herb', 'house'],
  ['toll-1', 'good:timber', 'toll'], ['toll-2', 'good:timber', 'toll'],
  ['guard-1', 'good:iron', 'guard'], ['guard-2', 'good:iron', 'guard'],
];
export const nodesAt = (shop) => NODES.filter((n) => n[2] === shop);
// The nine locations, the goods each counter trades, and the opening till.
export const SHOP_GOODS = {
  arena: ['good:iron', 'good:timber', 'good:herb', 'good:salt'],
  hall: ['good:iron', 'good:salt'], ferry: ['good:salt', 'good:timber'], toll: ['good:iron', 'good:timber'],
  guard: ['good:iron', 'good:herb'], bank: ['good:salt', 'good:herb'], house: ['good:timber', 'good:herb'],
  payouts: ['good:herb', 'good:timber'], chronicle: ['good:salt', 'good:iron'],
};
export const TARGET = 20;
export const FLOOR = 20n * MILLI;
export const OPEN_TILL = 60n * MILLI;
// Daily payout caps, as in the contract's Caps: per player and for the whole city (UTC day).
export const CAPS = { playerDay: 20n * MILLI, cityDay: 200n * MILLI };
const DAY_S = 86_400;

const err = (code) => { const e = new Error(code); e.code = code; return e; };

export function createCity({ till = OPEN_TILL, floor = FLOOR, caps = CAPS } = {}) {
  const shops = {};
  for (const [id, goods] of Object.entries(SHOP_GOODS)) {
    shops[id] = { id, till, floor, owed: 0n, shares: 0n, acc: 0n, trades: 0, goods: {} };
    for (const g of goods) shops[id].goods[g] = { stock: TARGET, hour: 0, buys: 0, sells: 0, prevBuys: 0, prevSells: 0 };
  }
  return { t: 0, caps, shops, players: {}, orders: [], nextOrder: 1, day: 0, paidToday: 0n, log: [] };
}

export function player(city, who) {
  return (city.players[who] ||= { bag: {}, near: 0n, rep: 0, toolUses: 0, lastGather: {}, debt: {}, day: 0, paid: 0n });
}

export const level = (rep) => { let l = 1, r = rep; while (r >= 3) { r = Math.floor(r / 3); l += 1; } return l; };
export const isOpen = (s) => s.till >= s.floor;
const hourOf = (t) => Math.floor(t / HOUR_S);

function demand(city, shop, good) {
  const d = city.shops[shop].goods[good];
  const h = hourOf(city.t);
  if (d.hour !== h) {
    const last = d.hour === h - 1;
    d.prevBuys = last ? d.buys : 0; d.prevSells = last ? d.sells : 0;
    d.buys = 0; d.sells = 0; d.hour = h;
  }
  return d;
}

export function quoteAt(city, shop, good) {
  const s = city.shops[shop]; if (!s?.goods[good]) throw err('ERR_GOOD');
  const d = demand(city, shop, good);
  return quote({ base: GOODS[good].base.toString(), stock: String(d.stock), target_stock: String(TARGET), buys_last_hour: d.prevBuys, sells_last_hour: d.prevSells, till: s.till.toString(), floor: s.floor.toString() });
}

const add = (p, g, n) => { p.bag[g] = (p.bag[g] || 0) + n; if (!p.bag[g]) delete p.bag[g]; };
const note = (city, e) => { city.log.push({ t: city.t, ...e }); if (city.log.length > 400) city.log.shift(); };

export function gather(city, who, node) {
  const n = NODES.find((x) => x[0] === node); if (!n) throw err('ERR_NODE');
  const p = player(city, who);
  const last = p.lastGather[node];
  if (last !== undefined && city.t < last + GATHER_S) throw err('ERR_TOO_SOON');
  p.lastGather[node] = city.t;
  let units = 1;
  if ((p.bag['item:tool'] || 0) > 0) { units = 2; p.toolUses += 1; if (p.toolUses >= TOOL_LIFE) { p.toolUses = 0; add(p, 'item:tool', -1); } }
  add(p, n[1], units);
  note(city, { who, kind: 'gather', good: n[1], qty: units });
  return units;
}

export const cooldown = (city, who, node) => {
  const last = player(city, who).lastGather[node];
  return last === undefined ? 0 : Math.max(0, last + GATHER_S - city.t);
};

// Counts NEAR paid to a player today against both daily caps (ERR_PLAYER_DAILY_CAP, ERR_CITY_DAILY_CAP).
function countPayout(city, who, amount) {
  const day = Math.floor(city.t / DAY_S), p = player(city, who);
  if (p.day !== day) { p.day = day; p.paid = 0n; }
  if (city.day !== day) { city.day = day; city.paidToday = 0n; }
  if (p.paid + amount > city.caps.playerDay) throw err('ERR_PLAYER_DAILY_CAP');
  if (city.paidToday + amount > city.caps.cityDay) throw err('ERR_CITY_DAILY_CAP');
  p.paid += amount; city.paidToday += amount;
}

export function paidToday(city, who) {
  const day = Math.floor(city.t / DAY_S), p = player(city, who);
  return p.day === day ? p.paid : 0n;
}

function credit(city, s, total) {
  let cut = 0n;
  if (s.owed > 0n && s.shares > 0n) {
    cut = (total * DIVIDEND_BPS) / 10_000n; if (cut > s.owed) cut = s.owed;
    s.acc += (cut * ACC) / s.shares; s.owed -= cut;
  }
  s.till += total - cut; s.trades += 1;
}

export function sell(city, who, shop, good, qty = 1) {
  const s = city.shops[shop]; if (!s?.goods[good]) throw err('ERR_GOOD');
  if (!isOpen(s)) throw err('ERR_SHOP_CLOSED');
  if (qty < 1 || qty > MAX_QTY) throw err('ERR_QTY');
  const p = player(city, who); if ((p.bag[good] || 0) < qty) throw err('ERR_BALANCE');
  const d = demand(city, shop, good);
  let total = 0n;
  for (let i = 0; i < qty; i++) { total += BigInt(quoteAt(city, shop, good).sell); d.stock += 1; }
  if (s.till < total) { d.stock -= qty; throw err('ERR_TILL'); }
  try { countPayout(city, who, total); } catch (e) { d.stock -= qty; throw e; }
  s.till -= total; d.sells += qty; s.trades += 1;
  add(p, good, -qty); p.near += total;
  const closed = !isOpen(s);
  note(city, { who, kind: 'sell', shop, good, qty, total, closed });
  return total;
}

export function buy(city, who, shop, good, qty = 1) {
  const s = city.shops[shop]; if (!s?.goods[good]) throw err('ERR_GOOD');
  if (qty < 1 || qty > MAX_QTY) throw err('ERR_QTY');
  const d = demand(city, shop, good); if (d.stock < qty) throw err('ERR_STOCK');
  const p = player(city, who);
  let total = 0n;
  for (let i = 0; i < qty; i++) { total += BigInt(quoteAt(city, shop, good).buy); d.stock -= 1; }
  if (p.near < total) { d.stock += qty; throw err('ERR_FUNDS'); }
  const wasClosed = !isOpen(s);
  p.near -= total; d.buys += qty; credit(city, s, total); add(p, good, qty);
  note(city, { who, kind: 'buy', shop, good, qty, total, reopened: wasClosed && isOpen(s) });
  return total;
}

export function craft(city, who, item) {
  const r = ITEMS[item]; if (!r) throw err('ERR_RECIPE');
  const p = player(city, who);
  for (const [g, n] of Object.entries(r.inputs)) if ((p.bag[g] || 0) < n) throw err('ERR_BALANCE');
  for (const [g, n] of Object.entries(r.inputs)) add(p, g, -n);
  add(p, item, 1);
  note(city, { who, kind: 'craft', item });
}

export function invest(city, who, shop, amount) {
  const s = city.shops[shop]; if (!s) throw err('ERR_SHOP');
  const units = amount / MILLI; if (units < 1n) throw err('ERR_SMALL');
  const p = player(city, who); const spend = units * MILLI;
  if (p.near < spend) throw err('ERR_FUNDS');
  const wasClosed = !isOpen(s);
  claim(city, who, shop);
  p.near -= spend; s.till += spend; s.shares += units; s.owed += (spend * REPAY_BPS) / 10_000n;
  const key = 'share:' + shop; add(p, key, Number(units));
  p.debt[shop] = BigInt(p.bag[key]) * s.acc / ACC;
  note(city, { who, kind: 'invest', shop, amount: spend, reopened: wasClosed && isOpen(s) });
  return units;
}

export function pending(city, who, shop) {
  const s = city.shops[shop], p = player(city, who);
  const held = BigInt(p.bag['share:' + shop] || 0);
  const owed = (held * s.acc) / ACC - (p.debt[shop] || 0n);
  return owed > 0n ? owed : 0n;
}

export function claim(city, who, shop) {
  const s = city.shops[shop], p = player(city, who);
  const amt = pending(city, who, shop);
  p.debt[shop] = (BigInt(p.bag['share:' + shop] || 0) * s.acc) / ACC;
  if (amt > 0n) { p.near += amt; note(city, { who, kind: 'claim', shop, total: amt }); }
  return amt;
}

export function postOrder(city, who, good, qty, reward, text) {
  const p = player(city, who); const escrow = reward * BigInt(qty);
  if (p.near < escrow) throw err('ERR_FUNDS');
  p.near -= escrow;
  const o = { id: city.nextOrder++, poster: who, good, qty, reward, text };
  city.orders.push(o); note(city, { who, kind: 'order', id: o.id, good, qty });
  return o.id;
}

export function fillOrder(city, who, id, qty = 1) {
  const o = city.orders.find((x) => x.id === id); if (!o) throw err('ERR_ORDER');
  if (o.poster === who) throw err('ERR_OWN_ORDER');
  if (qty < 1 || qty > o.qty) throw err('ERR_QTY');
  const p = player(city, who); if ((p.bag[o.good] || 0) < qty) throw err('ERR_BALANCE');
  const wage = o.reward * BigInt(qty); countPayout(city, who, wage);
  add(p, o.good, -qty); o.qty -= qty;
  p.near += wage; p.rep += 1;
  if (!o.qty) city.orders = city.orders.filter((x) => x !== o);
  note(city, { who, kind: 'fill', id, good: o.good, qty, total: wage });
  return wage;
}

export function advance(city, seconds) { city.t += seconds; }

// The city clock on screen: a 20-minute day of dawn, market, dusk and night.
export function cityClock(t) {
  const day = Math.floor(t / CITY_DAY_S) + 1;
  const f = (t % CITY_DAY_S) / CITY_DAY_S;
  const phase = f < 0.12 ? 'dawn' : f < 0.62 ? 'market' : f < 0.75 ? 'dusk' : 'night';
  const mins = Math.floor(f * 24 * 60);
  return { day, f, phase, hh: String(Math.floor(mins / 60)).padStart(2, '0'), mm: String(mins % 60).padStart(2, '0') };
}

// A seeded pseudo-random stream (LCG) so a fast-forward replays the same week.
export function rng(seed = 7) {
  let s = BigInt(seed) & 0xffffffffffffffffn;
  return () => { s = (s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn; return Number(s >> 33n) / 2 ** 31; };
}

const CROWD = ['miner-1', 'miner-2', 'miner-3', 'trader-1', 'trader-2', 'investor', 'council'];

// Fast-forward: seven days as 168 hourly ticks with a seeded crowd. Returns one row per hour.
// The council: a rule change voted by the city, not shipped by a developer. Here it lowers the floor a shop must hold
// to stay open, so fewer shops go dark. On chain this is a set_rules call on the market; in the practice round it is this.
export function councilVote(city, { floorBps = 7_500n } = {}) {
  for (const s of Object.values(city.shops)) s.floor = (s.floor * floorBps) / 10_000n;
  note(city, { who: 'council', kind: 'rule', rule: 'floor', bps: String(floorBps) });
}
export function runWeek({ seed = 7, hours = 168, city = createCity(), councilAt = 84 } = {}) {
  const r = rng(seed); const rows = []; const events = [];
  for (const who of CROWD) player(city, who).near = 200n * MILLI;
  const shops = Object.keys(city.shops);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const tryIt = (f) => { try { return f(); } catch { return null; } };
  for (let h = 0; h < hours; h++) {
    // Miners gather all hour and dump at one counter; traders chase the widest spread.
    for (const m of ['miner-1', 'miner-2', 'miner-3']) {
      for (let k = 0; k < 4; k++) { const n = pick(NODES); tryIt(() => gather(city, m, n[0])); advance(city, 31); }
      const p = player(city, m); const shop = pick(shops);
      for (const g of Object.keys(p.bag)) if (g.startsWith('good:') && city.shops[shop].goods[g]) tryIt(() => sell(city, m, shop, g, Math.min(MAX_QTY, p.bag[g])));
    }
    for (const tr of ['trader-1', 'trader-2']) {
      const g = pick(Object.keys(GOODS));
      const where = shops.filter((s) => city.shops[s].goods[g]);
      let lo = null, hi = null;
      for (const s of where) { const q = quoteAt(city, s, g); if (!lo || BigInt(q.buy) < lo.p) lo = { s, p: BigInt(q.buy) }; if (isOpen(city.shops[s]) && (!hi || BigInt(q.sell) > hi.p)) hi = { s, p: BigInt(q.sell) }; }
      if (lo && hi && hi.p > lo.p && lo.s !== hi.s) { if (tryIt(() => buy(city, tr, lo.s, g, 2)) !== null) tryIt(() => sell(city, tr, hi.s, g, 2)); }
    }
    // A dark shop: the council reopens it, or the investor buys shares.
    const dark = shops.filter((s) => !isOpen(city.shops[s]));
    if (dark.length) { const s = dark[0]; if (tryIt(() => invest(city, h % 2 ? 'council' : 'investor', s, 25n * MILLI)) !== null) events.push({ hour: h + 1, kind: 'reopen', shop: s }); }
    if (h % 24 === 18) { const s = pick(shops); note(city, { who: 'con-artist', kind: 'refused', shop: s, why: 'receiver_not_allowlisted' }); events.push({ hour: h + 1, kind: 'refused', shop: s }); }
    if (councilAt != null && h + 1 === councilAt) { councilVote(city); events.push({ hour: h + 1, kind: 'rule', rule: 'floor' }); }
    city.t = (h + 1) * HOUR_S;
    const avg = {};
    for (const g of Object.keys(GOODS)) {
      const where = shops.filter((s) => city.shops[s].goods[g]);
      avg[g] = where.reduce((a, s) => a + BigInt(quoteAt(city, s, g).buy), 0n) / BigInt(where.length);
    }
    rows.push({ hour: h + 1, avg, open: shops.filter((s) => isOpen(city.shops[s])).length, tills: shops.reduce((a, s) => a + city.shops[s].till, 0n) });
  }
  return { city, rows, events };
}
