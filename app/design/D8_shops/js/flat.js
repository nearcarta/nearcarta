// 2D fallback (?2d or no WebGL2): still pictures of each room plus the same tray and proof drawer.
import { $, tok } from './core.js';
import { QUOTE } from '../data/live.js';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SH = { guard: 'Guardhouse', ferry: 'Ferry', hall: 'Town Hall', bank: 'Mist Bank', arena: 'Vault Arena', toll: 'Toll Bridge', chronicle: 'Chronicle', house: 'Your House', payouts: 'Payouts' };
export function flat() {
  document.body.classList.add('flat', 'ready'); $('#load')?.remove(); const bg = document.createElement('div'); bg.id = 'flatbg'; document.body.prepend(bg); bg.style.backgroundImage = 'url(shots/fallback_town.jpg)';
  const nav = $('#tags'); for (const [id, n] of Object.entries(SH)) { const b = document.createElement('button'); b.className = 'lb'; b.textContent = n; b.onclick = () => open(id); nav.appendChild(b); }
  $('#back').onclick = () => { location.assign('/'); };
  $('#t-proof').onclick = () => $('#drawer').classList.add('open'); $('#d-close').onclick = () => $('#drawer').classList.remove('open');
  // A shop module that fails to import is shown as a failure, never as an empty room: console error, a coral tray
  // with one Reload action, and the error in the drawer. A module without a PROOF list is also logged and flagged.
  async function open(id) {
    let m = null, err = null;
    try { m = await import(`../shops/${id}.js`); } catch (e) { err = e; console.error(`[Nearcarta 2D] shop "${id}" failed to load:`, e); }
    bg.style.backgroundImage = `url(shots/fallback_${id}.jpg)`; nav.hidden = true; $('#back').hidden = false; $('#brand').hidden = true; document.body.classList.add('in-shop');
    const b = $('#t-act'), body = $('#d-body'); $('#t-title').textContent = SH[id]; document.body.toggleAttribute('data-shop-error', !!err);
    if (err) {
      $('#t-src').textContent = 'error'; $('#t-src').className = 'src error'; $('#t-label').textContent = 'This room could not load'; $('#t-hero').innerHTML = '';
      b.hidden = false; b.disabled = false; b.className = 'act primary'; b.textContent = 'Reload'; b.onclick = () => location.reload();
      body.innerHTML = `<p class="note proof-error">The ${esc(SH[id])} module failed to load, so there is no proof to show. ${esc(err.message || err)}</p>`;
    } else {
      // the 2D tray shows the end state (no scene to animate)
      const end = { guard: ['no', 'Refused · not on the list'], ferry: ['ok', 'Downgrade refused · crossed shielded'], hall: ['ok', 'Allowed · 0.001 NEAR'] }[id];
      const info = m.FLAT || FLAT[id]; $('#t-src').textContent = (globalThis.NEARCARTA_PUBLIC_MAINNET === true && { bank: 'mainnet · mainnet', payouts: 'mainnet', chronicle: 'mainnet' }[id]) || (info.src === 'mainnet' ? 'mainnet' : info.src); $('#t-src').className = 'src ' + info.cls; $('#t-label').textContent = info.label; $('#t-hero').innerHTML = info.hero;
      { const mo = $('#t-more'); mo.hidden = !m.MORE; if (m.MORE) { mo.href = m.MORE.href; mo.textContent = m.MORE.text; } }
      b.onclick = null; b.hidden = !end; if (end) { b.className = 'act res ' + end[0]; b.disabled = true; b.textContent = end[1]; }
      if (m.PROOF) body.innerHTML = m.PROOF;
      else { console.error(`[Nearcarta 2D] shop "${id}" exports no PROOF list`); body.innerHTML = '<p class="note proof-missing">This room has no proof list in the 2D view.</p>'; }
    }
    $('#tray').hidden = false; }
  // deep link: ?2d&shop=bank lands straight in that room
  const start = new URLSearchParams(location.search).get('shop'); if (start && SH[start]) open(start);
}
const FLAT = {
  guard: { src: 'mainnet', cls: 'split', label: 'Invoice with a hidden instruction', hero: tok('0.001', 'NEAR') },
  ferry: { src: 'mainnet quote', cls: 'quote', label: 'Shielded quote · Orchard-only UA', hero: `${tok(String(+QUOTE.from.amt), QUOTE.from.sym, { chain: QUOTE.from.chain })}<span class="arrow">→</span>${tok(QUOTE.to.amt, QUOTE.to.sym)}` },
  hall: { src: 'mainnet', cls: 'split', label: 'Reward paid', hero: tok('0.001', 'NEAR') },
  bank: { src: 'mainnet', cls: 'mainnet', label: 'Street sees a payout, not the amount', hero: '<span class="commit">sha256…</span><span class="unit">amount hidden</span>' },
  arena: { src: 'mainnet', cls: 'split', label: '5 attacks on the lab oath', hero: '<b class="num">0</b><span class="unit">breaches</span>' },
  toll: { src: 'mainnet', cls: 'split', label: '0.001 NEAR pass on mainnet', hero: '<b class="num">11</b><span class="unit">of 16 nodes</span>' },
  chronicle: { src: 'mainnet', cls: 'mainnet', label: 'Refusals on the record', hero: '<b class="num">6</b><span class="unit">of 10 actions</span>' },
  house: { src: 'mainnet', cls: 'split', label: 'Tip cap · policy v4', hero: tok('0.5', 'NEAR') },
};
