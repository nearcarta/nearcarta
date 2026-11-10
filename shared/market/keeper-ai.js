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
      if (og && Number(og.stock) > Number(g.stock)) out.push({ good: g.good, from: o.id, price: og.quote.buy, my_stock: Number(g.stock), their_stock: Number(og.stock) });
    }
  }
  return out.slice(0, 8);
}

export function restockMessages(shop, board, choices) {
  const me = board.find((s) => s.id === shop);
  const lines = choices.map((c, i) => `${i + 1}. buy ${c.good.slice(5)} from ${c.from} at ${c.price} yocto each (my shelf ${c.my_stock}, theirs ${c.their_stock})`);
  return [
    { role: 'system', content: 'You keep one shop in a city market. Reply with JSON only: {"pick": <number or 0>, "qty": <1 or 2>, "why": "<under 80 chars>"}. Pick 0 to do nothing. Restock only when your shelf is low and your till can afford it.' },
    { role: 'user', content: `Shop ${shop}. Till ${me.till} yocto, floor ${me.floor} yocto. Shelf: ${me.goods.map((g) => `${g.good.slice(5)} ${g.stock}`).join(', ')}.\nChoices:\n${lines.join('\n') || '(none)'}` },
  ];
}

export function councilMessages(shop, rule, value, why) {
  return [
    { role: 'system', content: 'You keep one shop in a city market and sit on its council. Reply with JSON only: {"yes": true|false, "why": "<under 80 chars>"}.' },
    { role: 'user', content: `Shop ${shop}. Proposal: set ${rule} to ${value}. Reason given: ${why}. floor_bps lowers the till floor below which shops close (10000 = 100%). Vote.` },
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
