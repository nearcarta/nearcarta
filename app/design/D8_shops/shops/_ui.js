// proof-drawer building blocks. Every row says where it comes from: testnet or a live read; nothing is sample data.
import { txLink, NB } from '../js/core.js';
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ST = { no: ['✕', 'no'], ok: ['✓', 'ok'], ice: ['❄', 'ice'], pend: ['○', 'pend'] };
export const row = ({ k, why = '', st = null, stText = '', tx = null, src = 'testnet' }) => {
  const s = st ? `<span class="st ${ST[st][1]}"><span aria-hidden="true">${ST[st][0]}</span>${esc(stText)}</span>` : '';
  const tag = src === 'live' ? '<span class="src live">live read</span>' : '';
  return `<div class="row"><div class="k">${esc(k)}${why ? `<span class="why">${esc(why)}</span>` : ''}</div><div class="v">${s}${tx ? txLink(tx) : tag}</div></div>`;
};
export const h3 = t => `<h3>${esc(t)}</h3>`;
export const note = t => `<p class="note">${t}</p>`;
export const proof = (...parts) => `<div class="pf">${parts.join('')}</div>`;
export const acct = a => `<a class="tx" href="https://testnet.nearblocks.io/address/${a}" target="_blank" rel="noopener">${esc(a)} ↗</a>`;
// a canvas texture for in-world paper (lines and marks only, no words)
export function paper(THREE, w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
// Mainnet: the same contracts live under nearcarta.near (shared/deployments/mainnet.json). The shop apps stay on testnet for the free guest demo.
const MN = {
  toll: ['toll.nearcarta.near', 'Allowed payment signed', '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz', 'Unlisted address refused', 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR'],
  arena: ['arena.nearcarta.near', 'Agent paid 0.001 NEAR', 'AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht', 'Agent asked 0.002, over the cap', '25LpJRFF6ugmRdF8eH7Rw7dpkMthQjG6XWXFyx9mqa6V'],
  house: ['house.nearcarta.near', 'House paid 0.001 NEAR', '83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26', 'House asked 0.002, over the cap', '3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1'],
  hall: ['townhall.nearcarta.near', 'Reward of 0.001 NEAR paid', '6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h', 'Reward of 0.002, over the cap', 'Cp2rWatnDBHRhbmGdrNqFbr14tg42TW4cAMTjp4Bsnu6'],
  guard: ['charter.nearcarta.near', 'Agent spent 0.001 NEAR', 'JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy', 'Agent asked 0.003, over the cap', 'BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH'],
};
const mtx = h => `<a class="tx" href="https://nearblocks.io/txns/${h}" target="_blank" rel="noopener">${h.slice(0, 6)}…${h.slice(-4)} ↗</a>`;
const mrow = (k, st, txt, h) => `<div class="row"><div class="k">${esc(k)}</div><div class="v"><span class="st ${st}"><span aria-hidden="true">${st === 'ok' ? '✓' : '✕'}</span>${txt}</span>${mtx(h)}</div></div>`;
export const mainnet = id => { const m = MN[id]; if (!m) return '';
  return `<div class="pf mn"><h3><span class="net mainnet">● mainnet</span> Live with real NEAR</h3>${mrow(m[1], 'ok', 'allowed', m[2])}${mrow(m[3], 'no', 'refused', m[4])}<p class="note">Contract <a class="tx" href="https://nearblocks.io/address/${m[0]}" target="_blank" rel="noopener">${m[0]} ↗</a>. Both payments are on mainnet.</p></div>`; };
