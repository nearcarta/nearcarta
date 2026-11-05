// Shows the look saved in setup on the town HUD, and tints the Lamplighter once the 3D cast exists.
// The name on the chip is the same session Town Hall and Mist Bank read.
import { visitor } from '../../D8_shops/js/session.js';
const KEY = 'nearcarta.hero.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
function chip(h) {
  const brand = document.getElementById('brand');
  let el = document.getElementById('heroChip');
  if (!brand || !h?.img || !h?.name) { el?.remove(); return; }
  if (!el) { el = document.createElement('a'); el.id = 'heroChip'; el.className = 'hero-chip'; el.href = '/setup/#character'; brand.append(el); }
  el.style.setProperty('--dye', /^#[0-9a-fA-F]{6}$/.test(h.dye || '') ? h.dye : '#d6b46a');
  if (el.dataset.img !== h.img) { el.dataset.img = h.img; el.innerHTML = '<img alt=""><span></span>'; el.querySelector('img').src = '/setup/chars/' + h.img + '.webp'; }
  const who = visitor();
  const label = who.signedIn ? (who.displayName || h.name) : 'Sign in';
  el.dataset.signed = who.signedIn ? '1' : '0';
  el.dataset.testid = 'hero-chip';
  el.querySelector('span').textContent = label;
  el.title = who.signedIn ? label + '. Change look' : 'Sign in';
}
function tint(h) {
  const R = window.CAST?.robot;
  if (!R?.root || !h?.dye || R.userData?.dyed === h.dye) return;
  const hex = String(h.dye).replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return;
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  R.root.traverse(m => {
    if (!m.isMesh || !m.material || m.userData?.ink) return;
    for (const mat of [].concat(m.material)) {
      if (!mat?.color || mat.userData?.base) continue;
      mat.userData = { ...(mat.userData || {}), base: mat.color.clone() };
      mat.color.r = Math.min(1, mat.userData.base.r * (0.45 + r));
      mat.color.g = Math.min(1, mat.userData.base.g * (0.45 + g));
      mat.color.b = Math.min(1, mat.userData.base.b * (0.45 + b));
    }
  });
  if (R.lantern?.goal?.set) R.lantern.goal.set(h.dye);
  if (h.name) R.name = h.name;
  R.userData = { ...(R.userData || {}), dyed: h.dye };
}
function fixCta() {
  const a = document.getElementById('t-cta');
  if (!a || a.hidden) return;
  if (/charter office/i.test(a.textContent || '')) a.setAttribute('href', '/shops/vault/');
}
export function applyTownHero() { const h = read(); chip(h); tint(h); fixCta(); }
applyTownHero();
setInterval(applyTownHero, 700);
addEventListener('storage', applyTownHero);
