// The visitor's agent: one of six looks, a dye, an outfit and a name.
// Saved in this browser and read by the town. Nothing here is written on chain.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const HERO_KEY = 'nearcarta.hero.v1';
export const LOOKS = [
  { id: 'knight', name: 'Warden', img: 'knight', blurb: 'Small caps. Few shops.', cap: 0.005, daily: 0.01, per: 3 },
  { id: 'mage', name: 'Scholar', img: 'mage', blurb: 'Books and data. Mid caps.', cap: 0.005, daily: 0.01, per: 3 },
  { id: 'rogue', name: 'Courier', img: 'rogue_hooded', blurb: 'Many tiny errands.', cap: 0.005, daily: 0.01, per: 3 },
  { id: 'robot', name: 'Clerk', img: 'robotexpressive', blurb: 'Steady invoice payments.', cap: 0.005, daily: 0.01, per: 3 },
  { id: 'barbarian', name: 'Buyer', img: 'barbarian', blurb: 'Bigger buys, few a day.', cap: 0.005, daily: 0.01, per: 3 },
  { id: 'scout', name: 'Scout', img: 'rogue', blurb: 'New shops, low budget.', cap: 0.005, daily: 0.01, per: 3 },
];
export const DYES = [
  { id: 'brass', name: 'Brass', hex: '#d6b46a' },
  { id: 'sea', name: 'Sea', hex: '#7eb8c9' },
  { id: 'wine', name: 'Wine', hex: '#c47b84' },
  { id: 'pine', name: 'Pine', hex: '#7daa78' },
  { id: 'ink', name: 'Ink', hex: '#9aa0c3' },
  { id: 'dawn', name: 'Dawn', hex: '#e6c2a0' },
];
export const OUTFITS = [
  { id: 'lantern', name: 'Lantern' },
  { id: 'cloak', name: 'Cloak' },
  { id: 'sash', name: 'Sash' },
];
const HEX = /^#[0-9a-fA-F]{6}$/;
export const displayOk = n => /^[A-Za-z][A-Za-z0-9][A-Za-z0-9 '.-]{0,22}$/.test(String(n || ''));

export function portraitHTML(look, dye, outfit, name) {
  const hex = HEX.test(dye?.hex || '') ? dye.hex : '#d6b46a';
  const fit = OUTFITS.some(o => o.id === outfit) ? outfit : 'lantern';
  const lamp = fit === 'lantern' ? '<svg class="lamp" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6v6" stroke="#f3ead8" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="16" r="4" fill="#ffc56e"/><circle cx="16" cy="16" r="8" fill="#ffc56e" opacity=".35"/></svg>' : '';
  return `<div class="portrait" data-outfit="${esc(fit)}" style="--dye:${hex}" data-testid="setup-portrait"><span class="glow"></span><img src="/setup/chars/${esc(look?.img || 'mage')}.webp" alt=""><span class="wash"></span>${lamp}<b>${esc(name || look?.name || 'Agent')}</b></div>`;
}

export function writeHero({ look, dye, outfit, name }) {
  const hero = { look: look?.id || 'mage', img: look?.img || 'mage', name: String(name || look?.name || 'Agent').slice(0, 24), dye: HEX.test(dye?.hex || '') ? dye.hex : '#d6b46a', outfit: outfit || 'lantern' };
  try { localStorage.setItem(HERO_KEY, JSON.stringify(hero)); } catch { /* private mode */ }
  return hero;
}
