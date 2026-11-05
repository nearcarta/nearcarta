// Pure Ferry pair helpers (city room + rules + agent chat).
// Sources: depth-plan-v2 §1 (all live 1Click assets); TOWN_PLAN live-oath-state for Ferry;
// 1Click tokens GET https://1click.chaindefuser.com/v0/tokens; brief-V V4.

/** Normalize a user/token id into symbol@chain. Accepts "USDC@base", "USDC|base", "USDC on base". */
export function toAsset(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const mAt = s.match(/^([A-Za-z0-9.]+)\s*[@|]\s*([A-Za-z0-9_-]+)$/);
  if (mAt) return `${mAt[1].toUpperCase()}@${mAt[2].toLowerCase()}`;
  const mOn = s.match(/^([A-Za-z0-9.]+)\s+on\s+([A-Za-z0-9_-]+)$/i);
  if (mOn) return `${mOn[1].toUpperCase()}@${mOn[2].toLowerCase()}`;
  // bare symbol → leave chain empty; caller fills default
  if (/^[A-Za-z0-9.]+$/.test(s)) return `${s.toUpperCase()}@`;
  return '';
}

/** Stable charter clause id for any 1Click pair (not only the 3 ZEC corridors). */
export function pairClauseId(from, to) {
  const n = (a) => String(a || '').toLowerCase().replace(/@/g, '-').replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const f = n(from), t = n(to || 'ZEC@zec');
  if (!f || !t) return '';
  return `route.${f}.${t}`;
}

export function isFerryClauseId(id) {
  if (!id || id === 'pay') return false;
  return /^route\./i.test(id);
}

export function parsePairClauseId(id) {
  if (!isFerryClauseId(id)) return null;
  const body = String(id).slice('route.'.length);
  const parts = body.split('.');
  if (parts.length < 2) return null;
  const mid = Math.floor(parts.length / 2);
  const fromBits = parts.slice(0, mid).join('-').split('-');
  const toBits = parts.slice(mid).join('-').split('-');
  // Prefer last segment as chain when shape is SYM-CHAIN
  const splitAsset = (bits) => {
    if (bits.length >= 2) return { sym: bits.slice(0, -1).join('-').toUpperCase(), chain: bits[bits.length - 1].toLowerCase() };
    return { sym: (bits[0] || '').toUpperCase(), chain: '' };
  };
  const from = splitAsset(fromBits);
  const to = splitAsset(toBits);
  return {
    from: from.chain ? `${from.sym}@${from.chain}` : from.sym,
    to: to.chain ? `${to.sym}@${to.chain}` : to.sym,
    fromSym: from.sym, fromChain: from.chain, toSym: to.sym, toChain: to.chain,
  };
}

/** Human chain label for tok()/crate icons. */
export function chainLabel(chain) {
  const k = String(chain || '').toLowerCase();
  const map = {
    base: 'Base', eth: 'Ethereum', ethereum: 'Ethereum', arb: 'Arbitrum', arbitrum: 'Arbitrum',
    near: 'NEAR', zec: 'Zcash', zcash: 'Zcash', sol: 'Solana', solana: 'Solana',
    bsc: 'BSC', polygon: 'Polygon', pol: 'Polygon', avax: 'Avalanche', optimism: 'Optimism', op: 'Optimism',
  };
  return map[k] || (chain ? String(chain) : '');
}

const SYMBOL_CASE = { WNEAR: 'wNEAR', USDC: 'USDC', USDT: 'USDT', NEAR: 'NEAR', ZEC: 'ZEC', ETH: 'ETH', WETH: 'WETH' };

/** Keep 1Click's symbol case. wNEAR is not WNEAR. */
export function canonSymbol(raw) {
  const u = String(raw || '').toUpperCase();
  return SYMBOL_CASE[u] || u;
}

// USDC typed without a chain stays Base, except a NEAR-origin swap whose destination USDC is the session corridor (USDC@near).
function chainFor(sym, given, role, fromChain) {
  if (given) return String(given).toLowerCase();
  const u = String(sym || '').toUpperCase();
  if (u === 'WNEAR' || u === 'NEAR') return 'near';
  if (u === 'ZEC') return 'zec';
  if (u === 'ETH' || u === 'WETH') return 'eth';
  if ((u === 'USDC' || u === 'USDT' || u === 'DAI') && role === 'to' && fromChain === 'near') return 'near';
  if ((u === 'USDC' || u === 'USDT' || u === 'DAI') && role === 'from') return 'base';
  return '';
}

function pairOf(amt, fromRaw, fromGiven, toRaw, toGiven) {
  const fromSym = canonSymbol(fromRaw);
  const fromChain = chainFor(fromSym, fromGiven, 'from', '');
  const toSym = canonSymbol(toRaw);
  const toChain = chainFor(toSym, toGiven, 'to', fromChain);
  const from = fromChain ? `${fromSym}@${fromChain}` : `${fromSym}@`;
  const to = toChain ? `${toSym}@${toChain}` : `${toSym}@`;
  return { amt: amt || '', from, to, fromId: from.replace('@', '|'), toId: to.replace('@', '|') };
}

/** Parse a natural-language Ferry ask into from/to/amount. Returns null if not a swap ask. */
export function parseAgentFerry(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  // "swap 0.05 wNEAR on NEAR to USDC", "get a quote for 3 USDC on base to ZEC", Arabic "حوّل 2 USDC لـ ZEC"
  const re = /(?:get\s+a\s+quote\s+for|quote|swap|convert|change|trade|exchange|حو[ّل]*|بدل)\s+(?:up\s+to\s+)?(\d+(?:\.\d+)?)\s+([A-Za-z0-9.]+)(?:\s*(?:@|on)\s*([A-Za-z0-9_-]+))?\s+(?:to|into|for|→|->|ل(?:ـ)?|إلى)\s+([A-Za-z0-9.]+)(?:\s*(?:@|on)\s*([A-Za-z0-9_-]+))?/i;
  const m = t.match(re);
  if (!m) {
    // "wNEAR@near → USDC" without a verb. A missing destination chain follows chainFor.
    const bare = t.match(/^(\d+(?:\.\d+)?)?\s*([A-Za-z0-9.]+)\s*(?:@|on)\s*([A-Za-z0-9_-]+)\s*(?:→|->|to|into|ل(?:ـ)?|إلى)\s*([A-Za-z0-9.]+)(?:\s*(?:@|on)\s*([A-Za-z0-9_-]+))?/i);
    if (!bare) return null;
    return pairOf(bare[1] || '', bare[2], bare[3], bare[4], bare[5] || '');
  }
  return pairOf(m[1], m[2], m[3] || '', m[4], m[5] || '');
}

/**
 * What the in-shop agent should do with one sentence.
 * quote: fill and quote only ("get a quote for …").
 * charter: same path as Ask charter (session stamp, then the deposit flow).
 * guest: demo crossing. setup: say open /setup, never a wallet.
 */
export function agentCargoPlan(text, { charterReady = false } = {}) {
  const raw = String(text || '').trim();
  const askCharter = /\bask\s+charter\b/i.test(raw);
  const loadCargo = /\bload\s+cargo\b/i.test(raw);
  const quoteOnly = /\b(?:get\s+a\s+quote|quote)\b/i.test(raw) && !askCharter && !loadCargo && !/\b(?:swap|convert|change|trade|exchange)\b/i.test(raw);
  const parsed = parseAgentFerry(raw);
  if (!parsed && !askCharter && !loadCargo) return { ok: false, hint: 'Try: Swap 0.05 wNEAR on NEAR to USDC, or get a quote for 0.05 wNEAR on NEAR to USDC' };
  if (parsed && (String(parsed.from).endsWith('@') || String(parsed.to).endsWith('@'))) {
    return { ok: false, hint: 'Name the chain too, e.g. USDC@base or USDC on Base.' };
  }
  let mode = 'guest';
  if (quoteOnly && parsed) mode = 'quote';
  else if (askCharter && !charterReady) mode = 'setup';
  else if (loadCargo && !askCharter) mode = 'guest';
  else if (charterReady) mode = 'charter';
  return { ok: true, parsed, mode };
}

/** Order-chip states sketched in TOWN_PLAN (Ferry open order) + D9 sFerry labels. */
export const ORDER_STATES = {
  jetty: { id: 'jetty', label: 'at the jetty', cls: 'order' },
  quoted: { id: 'quoted', label: 'quote stamped · waiting', cls: 'order gold' },
  loading: { id: 'loading', label: 'loading cargo', cls: 'order gold' },
  deposit: { id: 'deposit', label: 'waiting on 1Click', cls: 'order gold' },
  transit: { id: 'transit', label: 'in transit · mid-river', cls: 'order gold' },
  delivered: { id: 'delivered', label: 'far bank · delivered', cls: 'order ok' },
  refunded: { id: 'refunded', label: 'boat returns · refunded', cls: 'order no' },
  frozen: { id: 'frozen', label: 'moored · frozen', cls: 'order no' },
};

export function orderChipHtml(stateId) {
  const s = ORDER_STATES[stateId] || ORDER_STATES.jetty;
  return `<span class="ferry-order-chip" data-testid="ferry-order-chip" data-state="${s.id}">${s.label}</span>`;
}

/** YoctoNEAR rounded to 1e-6 NEAR. Same rounding as apps.js `toY`. */
function yoctoOfNear(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) throw new Error('ferry stamp is not a number');
  return BigInt(Math.round(x * 1e6)) * 10n ** 18n;
}

function yoctoOrNull(v) {
  if (v == null || v === '') return null;
  return BigInt(v);
}

/**
 * Ask-charter stamp in yoctoNEAR.
 * The USD-scaled fee can sit above a board row's per_action_cap (a ~$3 quote is
 * 0.03 NEAR; a setup row often caps one payment at 0.005). Clamp down to that cap.
 * If the result is under min_amount and that floor still fits in the cap, lift to it.
 * The stamp is never above a positive cap. No cap leaves the fee unchanged.
 */
export function ferryStampYocto(near, { capYocto = null, minYocto = null } = {}) {
  let amt = yoctoOfNear(near);
  const cap = yoctoOrNull(capYocto);
  const min = yoctoOrNull(minYocto);
  const hasCap = cap != null && cap > 0n;
  if (hasCap && amt > cap) amt = cap;
  if (min != null && min > 0n && amt < min && (!hasCap || min <= cap)) amt = min;
  if (hasCap && amt > cap) amt = cap;
  return amt.toString();
}
