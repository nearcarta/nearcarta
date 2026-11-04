// Token icons next to amounts. Local SVGs in /tokens/ (see /tokens/LICENSES.md).
const KNOWN = { near: 'NEAR', wnear: 'NEAR', usdc: 'USDC', usdt: 'USDT', zec: 'ZEC', taz: 'ZEC', eth: 'ETH', btc: 'BTC', sol: 'SOL', base: 'Base' };
const FILE = { wnear: 'near', taz: 'zec' };
export const tokenKey = s => { const k = String(s || '').toLowerCase().replace(/[^a-z]/g, ''); return KNOWN[k] ? k : null; };
export function tokenIcon(sym, size = 16) {
  const k = tokenKey(sym); if (!k) return '';
  return `<img class="tok" src="/tokens/${FILE[k] || k}.svg" alt="${KNOWN[k]}" width="${size}" height="${size}" loading="lazy" decoding="async">`;
}
// Decorate plain text already in the page: "0.01 NEAR", "ZEC", "Base Sepolia" get an icon before the symbol.
const RX = /(\d[\d.,]*)\s+(NEAR|USDC|USDT|ZEC|TAZ|ETH|BTC|SOL)\b/g;
export function decorate(root) {
  if (!root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => {
    const p = n.parentElement; if (!p || p.closest('script,style,textarea,input,code,pre,.tok-done,[contenteditable],option,.legal')) return NodeFilter.FILTER_REJECT;
    RX.lastIndex = 0; return RX.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
  const hits = []; while (w.nextNode()) hits.push(w.currentNode);
  for (const n of hits) {
    const span = document.createElement('span'); span.className = 'tok-done';
    RX.lastIndex = 0; span.innerHTML = n.data.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
      .replace(RX, (m, num, sym) => `<span class="tokw">${num}${tokenIcon(sym)} ${sym}</span>`);
    n.replaceWith(span);
  }
}
// Keep decorating as shops repaint.
export function watch(root) {
  if (!root || root.__tokWatch) return; root.__tokWatch = true; decorate(root);
  let t = 0; new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => decorate(root), 60); }).observe(root, { childList: true, subtree: true, characterData: true });
}
// shared polish stylesheet (token icons, subtitles, onboarding)
if (typeof document !== 'undefined' && !document.getElementById('polish-css')) { const l = document.createElement('link'); l.id = 'polish-css'; l.rel = 'stylesheet'; l.href = new URL('./polish.css', import.meta.url).href; document.head.appendChild(l); }
