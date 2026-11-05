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

/** Parse a natural-language Ferry ask into from/to/amount. Returns null if not a swap ask. */
export function parseAgentFerry(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  // "swap 3 USDC on Base to ZEC", "convert ETH@eth into NEAR@near", Arabic "حوّل 2 USDC لـ ZEC"
  const re = /(?:swap|convert|change|trade|exchange|حو[ّل]*|بدل)\s+(?:up\s+to\s+)?(\d+(?:\.\d+)?)\s+([A-Za-z0-9.]+)(?:\s*(?:@|on)\s*([A-Za-z0-9_-]+))?\s+(?:to|into|for|→|->|ل(?:ـ)?|إلى)\s+([A-Za-z0-9.]+)(?:\s*(?:@|on)\s*([A-Za-z0-9_-]+))?/i;
  const m = t.match(re);
  if (!m) {
    // "USDC@base → ZEC@zec" without verb
    const bare = t.match(/^(\d+(?:\.\d+)?)?\s*([A-Za-z0-9.]+)\s*(?:@|on)\s*([A-Za-z0-9_-]+)\s*(?:→|->|to|into|ل(?:ـ)?|إلى)\s*([A-Za-z0-9.]+)(?:\s*(?:@|on)\s*([A-Za-z0-9_-]+))?/i);
    if (!bare) return null;
    const amt = bare[1] || '';
    const from = `${bare[2].toUpperCase()}@${bare[3].toLowerCase()}`;
    const toChain = (bare[5] || (bare[4].toUpperCase() === 'ZEC' ? 'zec' : '')).toLowerCase();
    const to = toChain ? `${bare[4].toUpperCase()}@${toChain}` : `${bare[4].toUpperCase()}@`;
    return { amt, from, to, fromId: from.replace('@', '|'), toId: to.replace('@', '|') };
  }
  const amt = m[1];
  const fromSym = m[2].toUpperCase();
  const fromChain = (m[3] || (fromSym === 'ETH' ? 'eth' : fromSym === 'USDC' ? 'base' : '')).toLowerCase();
  const toSym = m[4].toUpperCase();
  const toChain = (m[5] || (toSym === 'ZEC' ? 'zec' : toSym === 'NEAR' ? 'near' : '')).toLowerCase();
  const from = fromChain ? `${fromSym}@${fromChain}` : `${fromSym}@`;
  const to = toChain ? `${toSym}@${toChain}` : `${toSym}@`;
  return { amt, from, to, fromId: from.replace('@', '|'), toId: to.replace('@', '|') };
}

/** Order-chip states sketched in TOWN_PLAN (Ferry open order) + D9 sFerry labels. */
export const ORDER_STATES = {
  jetty: { id: 'jetty', label: 'at the jetty', cls: 'order' },
  quoted: { id: 'quoted', label: 'quote stamped · waiting', cls: 'order gold' },
  loading: { id: 'loading', label: 'loading cargo', cls: 'order gold' },
  transit: { id: 'transit', label: 'in transit · mid-river', cls: 'order gold' },
  delivered: { id: 'delivered', label: 'far bank · delivered', cls: 'order ok' },
  refunded: { id: 'refunded', label: 'boat returns · refunded', cls: 'order no' },
  frozen: { id: 'frozen', label: 'moored · frozen', cls: 'order no' },
};

export function orderChipHtml(stateId) {
  const s = ORDER_STATES[stateId] || ORDER_STATES.jetty;
  return `<span class="ferry-order-chip" data-testid="ferry-order-chip" data-state="${s.id}">${s.label}</span>`;
}
