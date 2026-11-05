// Token + chain badges for ferry route chips and corridor cards.
// Assets: /tokens/*.svg (cryptocurrency-icons CC0 + app marks) and
// /tokens/chains/*.svg (copied from design/D2_game/d7/assets/tokens/chains,
// web3icons @web3icons/core MIT — see design/D7_system/tokens/token-icons.json).

const TOK = { NEAR: 'near', USDC: 'usdc', USDT: 'usdt', ETH: 'eth', BTC: 'btc', ZEC: 'zec', SOL: 'sol' };
const CHAIN = {
  eth: 'eth', ethereum: 'eth',
  base: 'base',
  arb: 'arb', arbitrum: 'arb',
  zec: 'zec', zcash: 'zec',
  near: 'near',
};

export function chainKey(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return CHAIN[k] || null;
}

export function parseRouteFrom(from) {
  const s = String(from || '');
  const at = s.indexOf('@');
  if (at < 0) return { sym: s || '', chain: '' };
  return { sym: s.slice(0, at), chain: s.slice(at + 1) };
}

/** Stacked token icon with optional chain badge (D8 tok().tic pattern). */
export function tokenBadge(sym, chain, { size = 22, chainSize = 12, cls = '' } = {}) {
  const file = TOK[String(sym || '').toUpperCase()];
  const ck = chainKey(chain);
  const ti = file
    ? `<img class="ti" src="/tokens/${file}.svg" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`
    : `<span class="ti coin" aria-hidden="true">${esc(String(sym || '?').slice(0, 1))}</span>`;
  const ci = ck
    ? `<img class="ci" src="/tokens/chains/${ck}.svg" alt="" title="on ${esc(String(chain))}" width="${chainSize}" height="${chainSize}" loading="lazy" decoding="async">`
    : '';
  return `<span class="tok ${cls}"><span class="tic">${ti}${ci}</span><span class="sym">${esc(sym || '')}</span></span>`;
}

/** Icon-only stack (no symbol text) for dense chips. */
export function tokenStack(sym, chain, { size = 28, chainSize = 14 } = {}) {
  const file = TOK[String(sym || '').toUpperCase()];
  const ck = chainKey(chain);
  const ti = file
    ? `<img class="ti" src="/tokens/${file}.svg" alt="${esc(sym || '')}" width="${size}" height="${size}" loading="lazy" decoding="async">`
    : `<span class="ti coin" aria-hidden="true">${esc(String(sym || '?').slice(0, 1))}</span>`;
  const ci = ck
    ? `<img class="ci" src="/tokens/chains/${ck}.svg" alt="" title="on ${esc(String(chain))}" width="${chainSize}" height="${chainSize}" loading="lazy" decoding="async">`
    : '';
  return `<span class="tic" aria-hidden="true">${ti}${ci}</span>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
