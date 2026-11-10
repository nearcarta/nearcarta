// Market Day as one story: a new merchant's first day, one step per shop. Each step's action is that
// shop's real feature; in practice the rules run here on the city simulation (./sim.js) and no
// transaction is sent. Recorded mainnet transactions are linked where the same action happened for real.
import * as S from './sim.js';

export const ME = 'you';
// 1 coin = 0.0001 NEAR in the practice round; the main flow only ever says coins.
export const COIN = S.MILLI / 10n;
export const TOLL = S.MILLI / 10n; // 0.0001 NEAR, paid from the sale
export const WAGE = (3n * S.MILLI) / 10n; // 0.0003 NEAR to the porter
export const STAKE = S.MILLI; // 0.001 NEAR into the dark shop
export const ORDER = { good: 'good:salt', qty: 3 };
const TX = (h) => ({ hash: h, url: `https://nearblocks.io/txns/${h}` });

// One row per shop, in walking order. `need` is the one line on the strip, `btn` the gold button,
// `reward` what you get. `done` is the line after the press. `intro` is the keeper's first line.
export const STEPS = [
  { id: 'order', shop: 'hall', keeper: 'Clerk', intro: 'Salt is short at the Square. Bring three.',
    need: 'Take today’s order', btn: 'Take order', reward: '3 salt to the Square', done: 'Order taken: 3 salt' },
  { id: 'cargo', shop: 'ferry', keeper: 'Ferryman', intro: 'Your salt came in from across the sea.',
    need: 'Unload salt from abroad', btn: 'Unload salt', reward: '+3 salt', done: '3 salt in your bag',
    proof: { label: 'Ferry: cross-chain swap (NEAR Intents)', ...TX('A6pqkcd3onJcAbJ2gCBNByejDkThARRkVshoXFB8zGkz') } },
  { id: 'cross', shop: 'toll', keeper: 'Toll warden', intro: 'Every crate pays to cross.',
    need: 'Get your cargo across', btn: 'Cross', reward: 'Toll 1 coin, paid from the sale', done: 'Across. The toll is due at the sale',
    proof: { label: 'Toll Bridge: crossing under the charter cap', ...TX('FwXfnyddVoZ7u6zYrF5Y3mWq9K5aHxrGc25CzM6JzpPj') } },
  { id: 'check', shop: 'guard', keeper: 'Captain', intro: 'Two buyers want your salt. One is lying.',
    need: 'Check your buyers', btn: 'Check buyers', reward: 'The con artist is refused', done: 'Square keeper cleared. Stranger refused',
    proof: { label: 'Guardhouse: con artist refused on chain', ...TX('E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ') } },
  { id: 'sell', shop: 'arena', keeper: 'Arena marshal', intro: 'The shelf decides the price. Watch it move.',
    need: 'Sell your salt', btn: 'Sell 3 salt', reward: 'Coins, at the shelf price', done: 'Sold' },
  { id: 'seal', shop: 'bank', keeper: 'Banker', intro: 'Profit is nobody’s business but yours.',
    need: 'Hide your profit', btn: 'Seal profit', reward: 'Amount hidden', done: 'Sealed. Only “check passed” shows' },
  { id: 'pay', shop: 'payouts', keeper: 'Paymaster', intro: 'Your porter carried every crate.',
    need: 'Pay your porter', btn: 'Pay 3 coins', reward: 'Invoice paid', done: 'Porter paid. Invoice kept' },
  { id: 'invest', shop: 'house', keeper: 'Housekeeper', intro: 'The Ferry spent its till on your cargo. It went dark.',
    need: 'Relight the Ferry', btn: 'Invest 10', reward: '10 coins for a Ferry share', done: 'The Ferry is open again' },
  { id: 'write', shop: 'chronicle', keeper: 'Archivist', intro: 'Every merchant’s day goes in the book.',
    need: 'Write your day', btn: 'Write the day', reward: 'Day seal · level 2', done: 'Day 1, written' },
];
export const STEP = Object.fromEntries(STEPS.map((s) => [s.id, s]));

export function state(city) {
  return (city.story ||= { day: 1, step: 0, met: {}, log: [], order: null, toll: 0n, sealed: false, dark: null, quote: null });
}
export const current = (city) => STEPS[state(city).step] || null;
export const progress = (city) => ({ done: Math.min(state(city).step, STEPS.length), total: STEPS.length });
export const finished = (city) => state(city).step >= STEPS.length;
export function stepAt(city, shop) { const s = current(city); return s && s.shop === shop ? s : null; }

const err = (code) => { const e = new Error(code); e.code = code; return e; };
const mark = (city, s, extra = {}) => { const st = state(city); st.log.push({ id: s.id, shop: s.shop, t: city.t, ...extra }); st.step += 1; };

// The sale preview for the Arena strip: what 3 salt fetch now, and the price before and after.
export function salePreview(city) {
  const p = S.player(city, ME); const n = Math.min(ORDER.qty, p.bag[ORDER.good] || 0);
  const before = BigInt(S.quoteAt(city, 'arena', ORDER.good).sell);
  return { n, before, quote: S.quoteAt(city, 'arena', ORDER.good) };
}

// Run the current step. Returns { line, total?, proof? }. Throws ERR_WRONG_SHOP off the path.
export function act(city, shop) {
  const s = current(city); if (!s) throw err('ERR_DONE'); if (s.shop !== shop) throw err('ERR_WRONG_SHOP');
  const st = state(city), p = S.player(city, ME);
  switch (s.id) {
    case 'order': st.order = { ...ORDER }; mark(city, s); return { line: s.done };
    case 'cargo': {
      let got = 0; for (const [node] of S.nodesAt('ferry')) { try { got += S.gather(city, ME, node); } catch {} }
      if (got < ORDER.qty) throw err('ERR_TOO_SOON');
      // The Ferry paid for the shipment from its till and goes dark until someone invests.
      const f = city.shops.ferry; f.till = f.floor - S.MILLI / 2n; st.dark = 'ferry';
      mark(city, s, { qty: got }); return { line: s.done, proof: s.proof };
    }
    case 'cross': st.toll = TOLL; mark(city, s, { total: TOLL }); return { line: s.done, proof: s.proof };
    case 'check': mark(city, s, { refused: 'stranger' }); return { line: s.done, proof: s.proof };
    case 'sell': {
      const before = BigInt(S.quoteAt(city, 'arena', ORDER.good).sell);
      const n = Math.min(ORDER.qty, p.bag[ORDER.good] || 0); if (!n) throw err('ERR_BALANCE');
      const total = S.sell(city, ME, 'arena', ORDER.good, n);
      const after = BigInt(S.quoteAt(city, 'arena', ORDER.good).sell);
      const toll = st.toll > total ? total : st.toll; p.near -= toll; city.shops.toll.till += toll; st.toll = 0n;
      st.quote = { before, after };
      mark(city, s, { qty: n, total, toll, before, after }); return { line: s.done, total, toll, before, after };
    }
    case 'seal': st.sealed = true; mark(city, s); return { line: s.done };
    case 'pay': {
      if (p.near < WAGE) throw err('ERR_FUNDS');
      p.near -= WAGE; S.player(city, 'porter').near += WAGE; mark(city, s, { total: WAGE }); return { line: s.done, total: WAGE };
    }
    case 'invest': {
      const shopId = st.dark || Object.values(city.shops).sort((a, b) => (a.till < b.till ? -1 : 1))[0].id;
      const units = S.invest(city, ME, shopId, STAKE); st.dark = S.isOpen(city.shops[shopId]) ? null : shopId;
      mark(city, s, { shop2: shopId, units, total: STAKE }); return { line: s.done, units, shop: shopId };
    }
    case 'write': p.rep += 3; mark(city, s, { level: S.level(p.rep) }); return { line: s.done, level: S.level(p.rep) };
  }
  throw err('ERR_STEP');
}

// Day over: the next day starts at the Hall again.
export function nextDay(city) { const st = state(city); if (!finished(city)) return false; st.day += 1; st.step = 0; st.log = []; st.order = null; st.sealed = false; return true; }
export function firstVisit(city, shop) { const st = state(city); if (st.met[shop]) return false; st.met[shop] = 1; return true; }
