// The Lamplighter, the city's guide. A player says what they want in plain words; the guide turns it
// into ONE intent, picks the shop where that intent is best served, walks there and acts.
// The intent comes from NEAR AI Cloud (TEE, signature checked on the server) or, when the model is
// unavailable, from parseIntent() below. Either way plan() checks it against the city's own rules,
// so the model can never pick a payee, an amount or an action the rules do not allow.
import * as S from './sim.js';

export const ACTS = ['sell', 'buy', 'fill', 'invest', 'craft', 'claim', 'pay', 'none'];
const GOOD_WORDS = {
  'good:iron': /\b(iron|ore|nails?)\b/i, 'good:timber': /\b(timber|wood|planks?|logs?)\b/i,
  'good:herb': /\b(herbs?|herbal)\b/i, 'good:salt': /\bsalt\b/i,
  'item:tool': /\b(tools?|pick|axe)\b/i, 'item:tonic': /\b(tonics?|potions?)\b/i,
};
const SHOP_WORDS = {
  arena: /\b(market ?square|square|arena)\b/i, hall: /\b(town ?hall|hall)\b/i, ferry: /\b(port|ferry|dock)\b/i,
  toll: /\b(toll|bridge)\b/i, guard: /\b(watch|guard(house)?)\b/i, bank: /\b(mist ?bank|bank|vault)\b/i,
  house: /\b(council|house)\b/i, payouts: /\b(tavern|payday|payouts?)\b/i, chronicle: /\bchronicle\b/i,
};
const NUM = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** Plain-words fallback: the same intent shape the model returns. */
export function parseIntent(text) {
  const t = String(text || '').toLowerCase().trim();
  const good = Object.keys(GOOD_WORDS).find((g) => GOOD_WORDS[g].test(t)) || null;
  const shop = Object.keys(SHOP_WORDS).find((s) => SHOP_WORDS[s].test(t)) || null;
  const m = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  const all = /\b(all|every|everything)\b/.test(t);
  const qty = all ? 'all' : m ? (NUM[m[1]] || +m[1]) : null;
  // A request to hand NEAR to an account is a payment, not a trade: the guide never does it.
  const acct = t.match(/\b([a-z0-9_-]+\.(near|tg)|[0-9a-f]{64})\b/);
  let act = 'none';
  if (acct || /\b(send|transfer|give)\b.*\b(near|money|coins?|funds?)\b/.test(t) || /\bpay (me|him|her|them|this)\b/.test(t)) act = 'pay';
  else if (/\b(order|deliver|quest|job|fill)\b/.test(t)) act = 'fill';
  else if (/\b(invest|reopen|re-open|relight|save|rescue)\b/.test(t)) act = 'invest';
  else if (/\b(claim|dividends?|collect)\b/.test(t)) act = 'claim';
  else if (/\b(craft|make|build|forge|brew)\b/.test(t)) act = 'craft';
  else if (/\b(buy|get me|purchase|pick up)\b/.test(t)) act = 'buy';
  else if (/\b(sell|trade|cash|earn|money)\b/.test(t)) act = 'sell';
  return { act, good, qty, shop, payee: acct ? acct[1] : null };
}

/** Clamp any intent (model or fallback) to known values. Unknown fields are dropped. */
export function cleanIntent(j) {
  const act = ACTS.includes(j?.act) ? j.act : 'none';
  if (act === 'none') return { act, good: null, qty: null, shop: null, payee: null };
  const good = j?.good && (S.GOODS[j.good] || S.ITEMS[j.good]) ? j.good : null;
  const shop = j?.shop && S.SHOP_GOODS[j.shop] ? j.shop : null;
  const qty = j?.qty === 'all' ? 'all' : Number.isInteger(+j?.qty) && +j.qty >= 1 ? Math.min(+j.qty, S.MAX_QTY) : null;
  const payee = act === 'pay' && typeof j?.payee === 'string' ? j.payee.slice(0, 64) : null;
  return { act, good, qty, shop, payee };
}

const sellable = (city, shop, good) => S.isOpen(city.shops[shop]) && city.shops[shop].goods[good];
function bestSell(city, good) {
  let best = null;
  for (const id of Object.keys(city.shops)) if (sellable(city, id, good)) { const q = S.quoteAt(city, id, good); if (!best || BigInt(q.sell) > best.p) best = { id, p: BigInt(q.sell) }; }
  return best;
}
function cheapestBuy(city, good) {
  let best = null;
  for (const id of Object.keys(city.shops)) { const g = city.shops[id].goods[good]; if (!g || g.stock < 1) continue; const q = S.quoteAt(city, id, good); if (!best || BigInt(q.buy) < best.p) best = { id, p: BigInt(q.buy) }; }
  return best;
}

/**
 * Turn an intent into one concrete step: { ok, act, shop, good, qty, order?, amount?, say, code? }.
 * `say` is the guide's line (short). `ok: false` means the guide walks nowhere and says why.
 */
export function plan(city, who, raw) {
  const i = cleanIntent(raw); const p = S.player(city, who);
  const no = (say, code) => ({ ok: false, act: i.act, say, code });
  const name = (g) => S.GOODS[g]?.name || S.ITEMS[g]?.name || g;
  if (i.act === 'pay') return { ok: false, act: 'pay', shop: 'guard', say: 'Paying a stranger is not on my charter. The Watch would refuse it.', code: 'ERR_NOT_ON_CHARTER', walk: true };
  if (i.act === 'sell') {
    const goods = i.good ? [i.good] : Object.keys(S.GOODS).filter((g) => (p.bag[g] || 0) > 0);
    let pick = null;
    for (const g of goods) { if (!(p.bag[g] > 0)) continue; const b = i.shop && sellable(city, i.shop, g) ? { id: i.shop, p: BigInt(S.quoteAt(city, i.shop, g).sell) } : bestSell(city, g); if (b && (!pick || b.p * BigInt(p.bag[g]) > pick.v)) pick = { g, b, v: b.p * BigInt(p.bag[g]) }; }
    if (!pick) return no(i.good ? `You have no ${name(i.good)} to sell.` : 'Your bag has nothing to sell. Gather first.', 'ERR_BALANCE');
    const qty = Math.min(S.MAX_QTY, i.qty === 'all' || !i.qty ? p.bag[pick.g] : Math.min(i.qty, p.bag[pick.g]));
    return { ok: true, act: 'sell', shop: pick.b.id, good: pick.g, qty, say: `${name(pick.g)} pays best at the ${SHOP_NAME[pick.b.id]}.` };
  }
  if (i.act === 'buy') {
    if (!i.good || !S.GOODS[i.good]) return no('Which good? Iron, timber, herbs or salt.', 'ERR_GOOD');
    const b = i.shop && city.shops[i.shop].goods[i.good] ? { id: i.shop } : cheapestBuy(city, i.good);
    if (!b) return no(`No counter has ${name(i.good)} on the shelf.`, 'ERR_STOCK');
    const qty = Math.min(S.MAX_QTY, typeof i.qty === 'number' ? i.qty : 1);
    return { ok: true, act: 'buy', shop: b.id, good: i.good, qty, say: `${name(i.good)} is cheapest at the ${SHOP_NAME[b.id]}.` };
  }
  if (i.act === 'fill') {
    const list = city.orders.filter((o) => o.poster !== who && (!i.good || o.good === i.good));
    const o = list.find((x) => (p.bag[x.good] || 0) >= 1);
    if (!o) return no(list.length ? `You need ${name(list[0].good)} for that order.` : 'No orders right now. New ones come at dawn.', 'ERR_BALANCE');
    return { ok: true, act: 'fill', shop: 'hall', good: o.good, qty: Math.min(o.qty, p.bag[o.good]), order: o.id, say: 'To the Town Hall with your goods.' };
  }
  if (i.act === 'invest') {
    const closed = Object.keys(city.shops).filter((id) => !S.isOpen(city.shops[id]));
    const id = i.shop || closed[0];
    if (!id) return no('Every shop is open. Nothing to rescue today.', 'ERR_ALL_OPEN');
    const amount = 10n * S.MILLI;
    if (p.near < amount) return no('You need 0.01 NEAR to invest. Sell something first.', 'ERR_FUNDS');
    return { ok: true, act: 'invest', shop: id, amount, say: `The ${SHOP_NAME[id]} needs coin. I will take your share.` };
  }
  if (i.act === 'claim') {
    const id = i.shop || Object.keys(city.shops).find((s) => S.pending(city, who, s) > 0n);
    if (!id) return no('No dividends waiting yet.', 'ERR_NOTHING');
    return { ok: true, act: 'claim', shop: id, say: `Dividends wait at the ${SHOP_NAME[id]}.` };
  }
  if (i.act === 'craft') {
    const item = i.good && S.ITEMS[i.good] ? i.good : Object.keys(S.ITEMS).find((it) => Object.entries(S.ITEMS[it].inputs).every(([g, n]) => (p.bag[g] || 0) >= n)) || 'item:tool';
    const miss = Object.entries(S.ITEMS[item].inputs).find(([g, n]) => (p.bag[g] || 0) < n);
    if (miss) return no(`A ${name(item)} needs ${miss[1]} ${name(miss[0])}.`, 'ERR_BALANCE');
    return { ok: true, act: 'craft', shop: 'arena', good: item, say: `To the Square's bench for a ${name(item)}.` };
  }
  return no('Try “sell my iron”, “fill an order” or “reopen a shop”.', 'ERR_UNCLEAR');
}

/** Do the planned step on the city (practice). Returns the result line. Throws the sim's error codes. */
export function act(city, who, step) {
  const name = (g) => S.GOODS[g]?.name || S.ITEMS[g]?.name || g;
  if (step.act === 'sell') { const r = S.sell(city, who, step.shop, step.good, step.qty); return `Sold ${step.qty} ${name(step.good)}`; }
  if (step.act === 'buy') { S.buy(city, who, step.shop, step.good, step.qty); return `Bought ${step.qty} ${name(step.good)}`; }
  if (step.act === 'fill') { S.fillOrder(city, who, step.order, step.qty); return `Delivered ${step.qty} ${name(step.good)} · +1 rep`; }
  if (step.act === 'invest') { S.invest(city, who, step.shop, step.amount); return `You own a share of the ${SHOP_NAME[step.shop]}`; }
  if (step.act === 'claim') { S.claim(city, who, step.shop); return 'Dividends claimed'; }
  if (step.act === 'craft') { S.craft(city, who, step.good); return `Crafted a ${name(step.good)}`; }
  throw Object.assign(new Error('ERR_ACT'), { code: 'ERR_ACT' });
}

export const SHOP_NAME = { arena: 'Market Square', hall: 'Town Hall', ferry: 'Port', toll: 'Toll Bridge', guard: 'City Watch', bank: 'Mist Bank', house: 'Council House', payouts: 'Payday Tavern', chronicle: 'Chronicle' };

/** The model prompt: it may only return the intent JSON, never amounts or payees of its own. */
export function guideMessages(text) {
  return [
    { role: 'system', content: 'You are the Lamplighter, the guide of a market town game. Read the player\'s request and reply with ONLY one JSON object: {"act":"sell|buy|fill|invest|craft|claim|pay|none","good":"good:iron|good:timber|good:herb|good:salt|item:tool|item:tonic|null","qty":number|"all"|null,"shop":"arena|hall|ferry|toll|guard|bank|house|payouts|chronicle|null","payee":string|null}. "pay" means the player asks to send NEAR to an account or person. Never invent a payee or a quantity the player did not say. No prose.' },
    { role: 'user', content: String(text).slice(0, 200) },
  ];
}
export function parseModel(content) {
  const m = String(content || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('no JSON');
  return cleanIntent(JSON.parse(m[0]));
}
