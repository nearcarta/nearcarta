// What a keeper asks NEAR AI, and the clamp on what it answers. Pure: no network, shared by the API,
// the box script and the tests. The model can only pick from the moves this function lists, so it
// cannot name a shop, a good, a quantity or a rule the market does not allow.
export const MAX_QTY = 2;
export const RULES = { floor_bps: [5000, 10000], stall_rent: [1e20, 1e22], stall_days: [1, 30] };

/** The restocks a keeper could make: a good its shop trades, bought from another shop whose shelf is fuller. */
export function restockChoices(board, shop) {
  const me = board.find((s) => s.id === shop); if (!me) return [];
  const out = [];
  for (const g of me.goods) {
    if (Number(g.stock) > 20) continue;
    for (const o of board) {
      if (o.id === shop || !o.open) continue;
      const og = o.goods.find((x) => x.good === g.good);
      if (og && Number(og.stock) > Number(g.stock)) out.push({ good: g.good, from: o.id, price: og.quote.buy, my_price: g.quote?.buy, my_stock: Number(g.stock), their_stock: Number(og.stock) });
    }
  }
  return out.slice(0, 8);
}

const milli = (y) => (Number(BigInt(y || 0) / 10n ** 18n) / 1000).toString();
export function restockMessages(shop, board, choices) {
  const me = board.find((s) => s.id === shop);
  const lines = choices.map((c, i) => `${i + 1}. buy ${c.good.slice(5)} from ${c.from} at ${milli(c.price)} milliNEAR each; my own shop sells it at ${c.my_price ? milli(c.my_price) : '?'} (my shelf ${c.my_stock}, theirs ${c.their_stock})`);
  return [
    { role: 'system', content: 'You keep one shop in a city market. Reply with JSON only: {"pick": <number or 0>, "qty": <1 or 2>, "why": "<under 80 chars>"}. Pick 0 to do nothing. Restock when it pays: the buy price is below what your own shop sells it at, and your till stays above its floor. Otherwise pick 0.' },
    { role: 'user', content: `Shop ${shop}. Till ${milli(me.till)} milliNEAR, floor ${milli(me.floor)} milliNEAR. Shelf: ${me.goods.map((g) => `${g.good.slice(5)} ${g.stock}`).join(', ')}.\nChoices:\n${lines.join('\n') || '(none)'}` },
  ];
}

// What a rule change means in plain numbers, so a keeper votes on the effect and not on the label.
const nearOf = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toString();
export function ruleEffect(rule, value, rules = {}, floorYocto) {
  if (rule === 'floor_bps') {
    const now = Number(rules.floor_bps ?? 10000), next = Number(value);
    const base = floorYocto ? ` A shop's base floor is ${nearOf(floorYocto)} NEAR: today it closes below ${nearOf((BigInt(floorYocto) * BigInt(now)) / 10000n)} NEAR; after the change, below ${nearOf((BigInt(floorYocto) * BigInt(next)) / 10000n)} NEAR.` : '';
    return `floor_bps is the share of its base floor a shop's till must keep to stay open. Now ${now} (${now / 100}%), proposed ${next} (${next / 100}%). ${next < now ? 'Lower means shops close less often but run on thinner tills.' : 'Higher means shops close sooner to protect their tills.'}${base}`;
  }
  if (rule === 'stall_rent') return `stall_rent is what a player pays to rent an Arena stall. Now ${nearOf(rules.stall_rent ?? '0')} NEAR, proposed ${nearOf(value)} NEAR.`;
  if (rule === 'stall_days') return `stall_days is how long a stall rental lasts. Now ${rules.stall_days ?? '?'} days, proposed ${value} days.`;
  return '';
}
export function councilMessages(shop, rule, value, why, ctx = {}) {
  return [
    { role: 'system', content: 'You keep one shop in a city market and sit on its council. Reply with JSON only: {"yes": true|false, "why": "<under 80 chars>"}.' },
    { role: 'user', content: `Shop ${shop}. Proposal: set ${rule} to ${value}. Reason given: ${why || 'none'}. ${ruleEffect(rule, value, ctx.rules, ctx.floor)} Vote.` },
  ];
}

const json = (s) => { const m = String(s || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('no json'); return JSON.parse(m[0]); };

/** Clamp a restock reply to one of the listed choices. Returns null for "do nothing". */
export function parseRestock(content, choices) {
  const j = json(content);
  const i = Number(j.pick) | 0; if (i < 1 || i > choices.length) return null;
  const qty = Math.min(MAX_QTY, Math.max(1, Number(j.qty) | 0));
  return { ...choices[i - 1], qty, why: String(j.why || '').slice(0, 80) };
}

export function parseVote(content) {
  const j = json(content);
  return { yes: j.yes === true, why: String(j.why || '').slice(0, 80) };
}

export function checkRule(rule, value) {
  const r = RULES[rule]; if (!r) return false;
  const v = Number(value); return v >= r[0] && v <= r[1];
}
