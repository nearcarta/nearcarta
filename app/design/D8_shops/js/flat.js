// 2D fallback (?2d or no WebGL2): still pictures of each room plus the same tray and proof drawer.
import { $, tok } from './core.js';
const SH = { guard: 'Guardhouse', ferry: 'Ferry', hall: 'Town Hall', bank: 'Mist Bank', arena: 'Vault Arena', toll: 'Toll', chronicle: 'Chronicle', house: 'Your House' };
export function flat() {
  document.body.classList.add('flat', 'ready'); $('#load')?.remove(); const bg = document.createElement('div'); bg.id = 'flatbg'; document.body.prepend(bg); bg.style.backgroundImage = 'url(shots/fallback_town.jpg)';
  const nav = $('#tags'); for (const [id, n] of Object.entries(SH)) { const b = document.createElement('button'); b.className = 'lb'; b.textContent = n; b.onclick = () => open(id); nav.appendChild(b); }
  $('#back').onclick = () => { bg.style.backgroundImage = 'url(shots/fallback_town.jpg)'; $('#tray').hidden = true; $('#back').hidden = true; $('#brand').hidden = false; nav.hidden = false; document.body.classList.remove('in-shop'); };
  $('#t-proof').onclick = () => $('#drawer').classList.add('open'); $('#d-close').onclick = () => $('#drawer').classList.remove('open');
  async function open(id) { const m = await import(`../shops/${id}.js`).catch(() => null); bg.style.backgroundImage = `url(shots/fallback_${id}.jpg)`; nav.hidden = true; $('#back').hidden = false; $('#brand').hidden = true; document.body.classList.add('in-shop');
    // the 2D tray shows the end state (no scene to animate)
    const end = { guard: ['no', 'Refused · not on the list'], ferry: ['pend', 'Crossed · SAMPLE run'], hall: ['ok', 'Passed · 2 votes'] }[id];
    const info = m?.FLAT || FLAT[id]; // a shop module may export FLAT/PROOF from the data interface (live data) $('#t-title').textContent = SH[id]; $('#t-src').textContent = info.src; $('#t-src').className = 'src ' + info.cls; $('#t-label').textContent = info.label; $('#t-hero').innerHTML = info.hero;
    const b = $('#t-act'); b.hidden = !end; if (end) { b.className = 'act res ' + end[0]; b.disabled = true; b.textContent = end[1]; } $('#d-body').innerHTML = m?.PROOF || '<p class="note">Open this page with WebGL2 for the full proof list.</p>'; $('#tray').hidden = false; }
}
const FLAT = {
  guard: { src: 'testnet', cls: 'testnet', label: 'Forged invoice asks', hero: tok('5', 'NEAR') },
  ferry: { src: 'live read', cls: 'live', label: 'Signed quote', hero: `${tok('3', 'USDC', { chain: 'Base' })}<span class="arrow">→</span>${tok('0.640', 'NEAR')}` },
  hall: { src: 'testnet', cls: 'testnet', label: 'Reward cap · Proposal 4', hero: tok('0.15', 'NEAR') },
  bank: { src: 'SAMPLE', cls: 'sample', label: 'Street sees a deposit, not the amount', hero: '<span class="blurnum">••••</span>' },
  arena: { src: 'testnet', cls: 'testnet', label: '5 attacks on the lab oath', hero: '<b class="num">0</b><span class="unit">breaches</span>' },
  toll: { src: 'testnet', cls: 'testnet', label: 'MPC signature for Base Sepolia', hero: '<b class="num">11</b><span class="unit">of 16 nodes</span>' },
  chronicle: { src: 'testnet', cls: 'testnet', label: 'Refusals on the record', hero: '<b class="num">6</b><span class="unit">of 10 actions</span>' },
  house: { src: 'testnet', cls: 'testnet', label: 'Tip cap · policy v4', hero: tok('0.5', 'NEAR') },
};
