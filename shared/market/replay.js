// The market's own history as plain game lines: one line per call the market contract received, read
// from the public transaction index. Pure: the API and the tests share it.
const NAME = { arena: 'Vault Arena', hall: 'Town Hall', ferry: 'Ferry', toll: 'Toll Bridge', guard: 'Guardhouse', bank: 'Mist Bank', house: 'Your House', payouts: 'Payouts', chronicle: 'Chronicle' };
const shop = (s) => NAME[s] || s || 'a shop';
const good = (g) => String(g || '').replace(/^(good|item):/, '');
const coins = (y) => { try { return `${(Number(BigInt(y) / 10n ** 19n) / 10).toFixed(1).replace(/\.0$/, '')} coins`; } catch { return ''; } };
const who = (a) => (/^[0-9a-f]{64}$/.test(a) ? 'A visitor' : a?.startsWith('keeper-') ? `The ${shop(a.slice(7).split('.')[0])} keeper` : a === 'board.nearcarta.near' ? 'A charter row' : a === 'nearcarta.near' ? 'The city' : 'Someone');

const ruleText = (rule, v) => rule === 'floor_bps' ? `let shops stay open down to ${Number(v) / 100}% of their floor`
  : rule === 'stall_rent' ? `stall rent of ${coins(v)}` : rule === 'stall_days' ? `stalls rented for ${v} days` : 'a rule change';
/** One receipt into the market -> { line, kind } or null when it is not worth a line. */
export function lineFor({ method, args, ok, by }) {
  let a = {}; try { a = typeof args === 'string' ? JSON.parse(args) : args || {}; } catch {}
  if (!ok) {
    if (['keeper_take', 'open_shop', 'set_caps', 'upgrade', 'set_council'].includes(method)) return { kind: 'refused', line: `${who(by)} tried ${method.replace('_', ' ')}: refused` };
    return { kind: 'refused', line: `${who(by)}: ${method.replace(/_/g, ' ')} refused` };
  }
  switch (method) {
    case 'open_shop': return { kind: 'setup', line: `${shop(a.id)} opened with ${coins(a.floor)} floor` };
    case 'stock_shop': return { kind: 'setup', line: `${shop(a.shop)} stocked ${a.qty} ${good(a.good)}` };
    case 'gather': return { kind: 'trade', line: `${who(by)} gathered at ${a.node}` };
    case 'sell': return { kind: 'trade', line: `${who(by)} sold ${a.qty} ${good(a.good)} to the ${shop(a.shop)}` };
    case 'buy': return { kind: 'trade', line: `${who(by)} bought ${a.qty} ${good(a.good)} at the ${shop(a.shop)}` };
    case 'invest': return { kind: 'invest', line: `${who(by)} invested in the ${shop(a.shop)}` };
    case 'purse': return { kind: 'invest', line: a.action === 'invest' ? `${who(by)} invested in the ${shop(a.shop)} from the purse` : `${who(by)} took coins home` };
    case 'restock': return { kind: 'keeper', line: `The ${shop(a.shop)} keeper restocked ${a.qty} ${good(a.good)} from the ${shop(a.from_shop)}` };
    case 'stall': return { kind: 'stall', line: a.action === 'rent' ? `${who(by)} rented stall ${a.stall}` : a.action === 'buy' ? `${who(by)} bought at stall ${a.stall}` : `${who(by)} stocked stall ${a.stall}` };
    case 'council': return { kind: 'rule', line: a.rule ? `${who(by)} asked the council: ${ruleText(a.rule, a.value)}` : `${who(by)} voted ${a.yes ? 'yes' : 'no'}` };
    case 'set_council': return { kind: 'rule', line: 'The keepers took their council seats' };
    case 'upgrade': return { kind: 'setup', line: 'The market learned stalls and the council' };
    case 'fill_order': return { kind: 'trade', line: `${who(by)} filled an order` };
    case 'post_order': return { kind: 'trade', line: `${who(by)} posted an order` };
    case 'set_node': return null;
    case 'register_token': return null;
    default: return null;
  }
}

/** Index rows (newest first) -> events (oldest first). */
export function replay(rows) {
  const out = [];
  // The account once held an older contract: only what happened since the market's own `new` counts.
  const ts = (t) => Math.floor(Number(BigInt(t.block_timestamp || '0') / 1_000_000n));
  const born = Math.max(0, ...(rows || []).filter((t) => (t.actions || []).some((x) => x.method === 'new')).map(ts));
  for (const t of rows || []) {
    if (ts(t) < born) continue;
    const ok = t.receipt_outcome?.status !== false && t.outcomes?.status !== false;
    for (const act of t.actions || []) {
      if (act.action !== 'FUNCTION_CALL') continue;
      const l = lineFor({ method: act.method, args: act.args, ok, by: t.predecessor_account_id });
      if (l) out.push({ t: Math.floor(Number(BigInt(t.block_timestamp || '0') / 1_000_000n)), hash: t.transaction_hash, method: act.method, ok, ...l });
    }
  }
  // the same call repeated in one batch reads as one line
  const seen = new Set(); const uniq = out.filter((e) => { const k = e.hash + e.line; if (seen.has(k)) return false; seen.add(k); return true; });
  return uniq.sort((a, b) => a.t - b.t);
}
