// D7 token chips. Reads design/assets/tokens/manifest.json (web3icons, MIT), which maps the NEAR Intents 1Click symbols.
// A symbol without an icon gets a monogram drawn in CSS, never stand-in art.
let M = null, BASE = '';
export async function loadTokens(base) { BASE = base.replace(/\/?$/, '/'); if (!M) M = await fetch(BASE + 'manifest.json').then(r => r.json()).catch(() => ({ tokens: {}, chains: {} })); return M; }
const hue = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
export function tokenIcon(sym, size = 20) {
  const t = M?.tokens?.[sym] || M?.tokens?.[sym?.toUpperCase()];
  if (t) return `<img src="${BASE}${t.file}" width="${size}" height="${size}" alt="" decoding="async" loading="lazy">`;
  const m = (sym || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
  return `<span class="d7-mono-ic" style="--h:${hue(sym || '?')}" aria-hidden="true">${m}</span>`;
}
export function chainIcon(chain) { const c = M?.chains?.[chain]; return c ? `<img class="d7-chain" src="${BASE}${c.file}" alt="" width="12" height="12" decoding="async" loading="lazy">` : ''; }
const fmt = (n, d) => typeof n === 'number' ? n.toLocaleString('en-US', { minimumFractionDigits: d ?? (n < 1 ? 3 : 2), maximumFractionDigits: d ?? (n < 1 ? 4 : 2) }) : n;
// chip({sym:'USDC', amount:50, chain:'base', size:'lg'|'', bare:false})
export function chip({ sym, amount, chain, size = '', bare = false, decimals }) {
  return `<span class="d7-token${size ? ' d7-token--' + size : ''}${bare ? ' d7-token--bare' : ''}" title="${sym}${chain ? ' on ' + chain : ''}">${tokenIcon(sym, size === 'lg' ? 26 : 20)}${chain ? chainIcon(chain) : ''}${amount != null ? `<span class="d7-amt">${fmt(amount, decimals)}</span>` : ''}<span class="d7-sym">${sym}</span></span>`;
}
// Turns every [data-token="USDC"] (with optional data-amount, data-chain) under root into a chip
export function hydrate(root = document) { root.querySelectorAll('[data-token]').forEach(e => { const a = e.dataset.amount; e.outerHTML = chip({ sym: e.dataset.token, amount: a != null ? +a : undefined, chain: e.dataset.chain, size: e.dataset.size || '', bare: 'bare' in e.dataset }); }); }
export function symbols() { return Object.keys(M?.tokens || {}); }
export function missing() { return (M?.missing || []).filter(s => !s.startsWith('chain:')); }
