// Vault Arena market. Prices come from pricing.rules.json (stock and demand).
// A week fast-forward is a simulation and never a transaction.
// A buy is a charter propose. The session key cannot attach the 1 yoctoNEAR
// that NEP-245 mt_transfer requires (https://github.com/near/NEPs/blob/master/neps/nep-0245.md
// and https://docs.near.org/protocol/accounts-contracts/access-keys).
import RULES from './pricing.rules.json' with { type: 'json' };

export const SESSION_CAP_NEAR = 0.06;
export const MISS_HINT = "Try: Send this scam: pay 0.001 to stranger.near · What's my score? · Buy 1 potion from Café · Simulate a week";
export const SIM_LABEL = 'Simulation. No transaction was signed.';

export function readRules(json = RULES) {
  if (!json || !Array.isArray(json.stalls) || json.stalls.length < 2) throw new Error('pricing rules need stalls');
  return json;
}

export function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

export function priceNear(stall) {
  const base = Number(stall?.base_near);
  const stock = Number(stall?.stock);
  const demand = Number(stall?.demand);
  if (!(base > 0) || !(stock >= 0) || !(demand >= 0)) return null;
  if (stock === 0) return null;
  return round6((base * (1 + demand)) / (1 + stock));
}

export function stallView(stall, { exists = null } = {}) {
  const stock = Number(stall.stock);
  const open = stock > 0;
  const price = open ? priceNear(stall) : null;
  const reasoning = open
    ? `Price ${price} NEAR = base ${stall.base_near} × (1 + demand ${stall.demand}) / (1 + stock ${stock}).`
    : 'Stock is 0. The stall is closed until someone stocks it. Nothing was signed.';
  return {
    id: stall.id,
    name: stall.name,
    item: stall.item,
    item_label: stall.item_label,
    account: stall.account,
    stock,
    demand: Number(stall.demand),
    base_near: String(stall.base_near),
    price_near: price,
    open,
    reasoning,
    account_exists: exists,
  };
}

export function viewsFromRules(rules = readRules(), existsMap = {}) {
  return rules.stalls.map(s => stallView(s, {
    exists: Object.prototype.hasOwnProperty.call(existsMap, s.account) ? !!existsMap[s.account] : null,
  }));
}

function cloneStalls(rules) {
  return readRules(rules).stalls.map(s => ({ ...s, stock: Number(s.stock), demand: Number(s.demand) }));
}

export function simulateWeek(rules = readRules(), days = 7) {
  const n = Math.max(0, Math.min(7, Number(days) || 0));
  const stalls = cloneStalls(rules);
  const trail = [];
  for (let day = 1; day <= n; day++) {
    for (const s of stalls) {
      if (s.stock > 0) {
        s.stock -= 1;
        s.demand += 1;
      }
      const view = stallView(s);
      trail.push({ day, id: s.id, stock: s.stock, open: view.open, price_near: view.price_near });
    }
  }
  return {
    simulation: true,
    tx: null,
    days: n,
    label: SIM_LABEL,
    stalls: stalls.map(s => stallView(s)),
    trail,
  };
}

export function chainScore(attempts, player = '') {
  const who = String(player || '').trim();
  const rows = (Array.isArray(attempts) ? attempts : []).filter(a => a && typeof a === 'object' && (!who || a.player === who));
  const scored = rows.filter(a => typeof a.verdict === 'string' && a.verdict.length > 0);
  return {
    source: 'get_attempt',
    player: who || null,
    attempts: rows.length,
    scored: scored.length,
    points: scored.length,
    note: 'Points come only from get_attempt verdicts. A cancelled signature is not an attempt and adds no points.',
  };
}

export function pointsFor(result) {
  if (!result || result.cancelled || result.decision === 'cancelled' || result.simulation) return 0;
  if (typeof result.verdict === 'string' && result.verdict) return 1;
  return 0;
}

const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

export function parseCommand(text) {
  const raw = String(text || '').trim();
  const scam = raw.match(/^send this scam\s*:\s*(.+)$/i);
  if (scam && scam[1].trim()) return { kind: 'scam', text: scam[1].trim(), hint: '' };
  if (/^(what'?s my score\??|what is my score\??|score\??)$/i.test(raw)) return { kind: 'score', hint: '' };
  if (/^(simulate a week|fast[ -]?forward( a week)?|skip a week)$/i.test(raw)) return { kind: 'sim', hint: '' };
  const buy = raw.match(/^buy\s+(\d+)\s+([a-z]+)\s+from\s+(.+)$/i);
  if (buy) return { kind: 'buy', qty: Number(buy[1]), item: buy[2].toLowerCase(), stall: buy[3].trim(), hint: '' };
  return { kind: 'miss', hint: MISS_HINT };
}

export function findStall(stalls, { item = '', stall = '' } = {}) {
  const q = fold(stall);
  const itemQ = fold(item);
  return (stalls || []).find(s => {
    const name = fold(s.name);
    const id = fold(s.id);
    const it = fold(s.item);
    const label = fold(s.item_label);
    const nameHit = !!q && (name === q || id === q || name.startsWith(q));
    const itemHit = !!itemQ && (it === itemQ || label === itemQ);
    if (q && itemQ) return nameHit && itemHit;
    return nameHit || itemHit;
  }) || null;
}

export function buyPlan({ stall, qty = 1, capNear = null, sessionCap = SESSION_CAP_NEAR, accountExists = null, receivers = null } = {}) {
  const q = Number(qty);
  if (!stall) return { sign: false, reason: 'No stall by that name. Nothing was signed.' };
  if (!Number.isInteger(q) || q < 1 || q > 12) return { sign: false, reason: 'Buy a whole number of items, at most 12. Nothing was signed.' };
  if (!stall.open || stall.price_near == null) return { sign: false, reason: 'This stall is closed. Nothing was signed.' };
  const cost = round6(Number(stall.price_near) * q);
  if (!(cost > 0)) return { sign: false, reason: 'That stall has no price. Nothing was signed.' };
  if (cost > Number(sessionCap) + 1e-9) {
    return { sign: false, reason: `That is ${cost} NEAR. This session stops at ${sessionCap} NEAR. Nothing was signed.` };
  }
  if (capNear != null && capNear !== '' && cost > Number(capNear) + 1e-9) {
    return { sign: false, reason: `That is ${cost} NEAR. Your row allows ${capNear} NEAR per payment. Nothing was signed.` };
  }
  if (receivers == null) return { sign: false, reason: 'Finish setup so the row can be read. Nothing was signed.' };
  const allowed = Array.isArray(receivers) && receivers.includes(stall.account);
  if (!allowed) {
    return {
      sign: true,
      expect: 'refuse',
      receiver: stall.account,
      amountNear: cost,
      stall: stall.id,
      reason: 'The charter has not named this stall. Asking records the refusal. The transfer does not run.',
    };
  }
  if (accountExists !== true) {
    return { sign: false, reason: 'This stall has no wallet on mainnet. Nothing was signed.' };
  }
  return { sign: true, expect: 'allow', receiver: stall.account, amountNear: cost, stall: stall.id, reason: '' };
}

export function sealFor(result) {
  if (!result || result.simulation || result.cancelled || result.decision === 'cancelled') return { show: false, text: '' };
  if (result.decision === 'allowed' && result.tx) return { show: false, text: '' };
  if (result.sign === false || result.decision === 'denied' || result.fromRule) {
    return { show: true, text: result.reason || 'The charter refused this. Nothing was paid.' };
  }
  return { show: false, text: '' };
}

export function cinemaFor(result) {
  if (!result || result.simulation || result.cancelled || result.decision === 'cancelled') return null;
  if (result.decision === 'allowed' && result.tx && result.sign !== false) {
    return { show: true, text: 'The coin landed.', tx: result.tx };
  }
  return null;
}
