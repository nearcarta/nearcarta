// proof-drawer building blocks. Every row says where it comes from: REAL testnet, live read, or SAMPLE.
import { txLink, NB } from '../js/core.js';
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ST = { no: ['✕', 'no'], ok: ['✓', 'ok'], ice: ['❄', 'ice'], pend: ['○', 'pend'] };
export const row = ({ k, why = '', st = null, stText = '', tx = null, src = 'testnet' }) => {
  const s = st ? `<span class="st ${ST[st][1]}"><span aria-hidden="true">${ST[st][0]}</span>${esc(stText)}</span>` : '';
  const tag = src === 'sample' ? '<span class="src sample">SAMPLE</span>' : src === 'live' ? '<span class="src live">live read</span>' : '';
  return `<div class="row"><div class="k">${esc(k)}${why ? `<span class="why">${esc(why)}</span>` : ''}</div><div class="v">${s}${tx ? txLink(tx) : tag}</div></div>`;
};
export const h3 = t => `<h3>${esc(t)}</h3>`;
export const note = t => `<p class="note">${t}</p>`;
export const proof = (...parts) => `<div class="pf">${parts.join('')}</div>`;
export const acct = a => `<a class="tx" href="https://testnet.nearblocks.io/address/${a}" target="_blank" rel="noopener">${esc(a)} ↗</a>`;
// a canvas texture for in-world paper (lines and marks only, no words)
export function paper(THREE, w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
