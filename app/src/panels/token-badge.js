// Token + chain badges for ferry route chips, corridor cards, and quote rows.
// Assets: /tokens/*.svg (cryptocurrency-icons CC0 + app marks) and
// /tokens/chains/*.svg (web3icons MIT for eth/base/arb; app-drawn circular ZEC).
// See tokens/LICENSES.md.

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
  if (at < 0) return { sym: s.trim() || '', chain: '' };
  return { sym: s.slice(0, at).trim(), chain: s.slice(at + 1).trim() };
}

function symKey(sym) {
  return String(sym || '').trim().toUpperCase();
}

function letterFallback(sym) {
  const s = symKey(sym);
  return s ? s.slice(0, 1) : '·';
}

/** img that falls back to a brass letter coin if the SVG fails to paint. No inline handlers (CSP). */
function tokenImg(file, sym, size) {
  const letter = esc(letterFallback(sym));
  return `<img class="ti" src="/tokens/${file}.svg" alt="${esc(sym || '')}" width="${size}" height="${size}" loading="lazy" decoding="async" data-letter="${letter}" data-ti-fallback="1">`;
}

/** Wire image→letter fallbacks without inline onerror (CSP script-src blocks inline handlers). */
export function bindTokenFallbacks(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('img.ti[data-ti-fallback]').forEach(img => {
    if (img.dataset.tiBound) return;
    img.dataset.tiBound = '1';
    const fail = () => {
      const s = document.createElement('span');
      s.className = 'ti coin';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = img.getAttribute('data-letter') || '·';
      img.replaceWith(s);
    };
    img.addEventListener('error', fail, { once: true });
    if (img.complete && img.naturalWidth === 0) fail();
  });
}

function chainImg(ck, chain, size) {
  return `<img class="ci" src="/tokens/chains/${ck}.svg" alt="" title="on ${esc(String(chain))}" width="${size}" height="${size}" loading="lazy" decoding="async">`;
}

/** Stacked token icon with optional chain badge (D8 tok().tic pattern). */
export function tokenBadge(sym, chain, { size = 22, chainSize = 12, cls = '' } = {}) {
  const key = symKey(sym);
  const file = TOK[key];
  const ck = chainKey(chain);
  const ti = file
    ? tokenImg(file, key, size)
    : `<span class="ti coin" aria-hidden="true">${esc(letterFallback(key))}</span>`;
  const ci = ck ? chainImg(ck, chain, chainSize) : '';
  return `<span class="tok ${cls}"><span class="tic">${ti}${ci}</span><span class="sym">${esc(key || sym || '')}</span></span>`;
}

/** Icon-only stack (no symbol text) for dense chips. */
export function tokenStack(sym, chain, { size = 28, chainSize = 14 } = {}) {
  const key = symKey(sym);
  const file = TOK[key];
  const ck = chainKey(chain);
  const ti = file
    ? tokenImg(file, key, size)
    : `<span class="ti coin" aria-hidden="true">${esc(letterFallback(key))}</span>`;
  const ci = ck ? chainImg(ck, chain, chainSize) : '';
  return `<span class="tic" aria-hidden="true">${ti}${ci}</span>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
