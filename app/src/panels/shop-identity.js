// Each shop's own identity, inside the one shared panel system.
//
// The references give every shop a round icon badge, a 48px illustration in the header and a
// flow card that says what the shop does in one line. This file is the single place those three
// things are defined, so the nine shops cannot drift apart again.
//
// Icons come from the project's own 3D icon set (design/D2_game/d7/assets/3dicons). Tokens come
// from the same /tokens sprites the shops already use. Nothing here is a new dependency and no
// image is invented: if an icon is missing the badge falls back to the shop's initial, so a
// missing asset can never break a panel.

const ICON_BASE = '/design/D2_game/d7/assets/3dicons/192';

/** The 3D icon for a shop, or null when it is not in the set. */
const ICON = {
  hall: 'file-text',      // the scroll / job sheet
  payouts: '3d-coin',     // the coin stack
  guard: 'zoom',          // the magnifier
  arena: 'shield',        // the guardian's shield
  ferry: 'flash',         // the swap: value moving
  bank: 'wallet',         // the statement
  chronicle: 'explorer',  // the record
  toll: 'link',           // the bridge between chains
  house: 'key',           // the deed / the agent's key
};

/** Header illustration: the same asset, drawn larger. The reference shows one per shop. */
export const illustration = id => ICON[id] ? `${ICON_BASE}/${ICON[id]}-premium.webp` : '';

/** The round badge in the header. */
export function badge(id, size = 44) {
  const src = illustration(id);
  if (src) return `<img class="panel-badge" src="${src}" alt="" width="${size}" height="${size}" decoding="async">`;
  const letter = String(id || '?').slice(0, 1).toUpperCase();
  return `<span class="panel-badge panel-badge-letter" aria-hidden="true">${letter}</span>`;
}

/**
 * The 48px decorative illustration on the right of the header, as in both reference images.
 * It must NOT be the same picture as the badge or the header reads as a duplicated icon, so it
 * is a different icon from the same set, chosen per shop to say something about the function.
 * It is decorative and aria-hidden: the title already names the shop.
 */
const ART = {
  hall: 'file-text',
  payouts: 'money-bag',
  guard: 'shield',
  arena: 'medal',
  ferry: 'rocket',
  bank: 'chart',
  chronicle: 'map-pin',
  toll: 'link',
  house: 'key',
};

export function headerArt(id) {
  const name = ART[id];
  if (!name) return '';
  return `<img class="panel-art" src="${ICON_BASE}/${name}-premium.webp" alt="" width="48" height="48" decoding="async" aria-hidden="true">`;
}

/** A token chip for the flow card, using the sprite the shops already ship. */
const tok = (sym, label) => `<span class="flow-tok" title="${label || sym}"><img src="/tokens/${sym}.svg" alt="${label || sym}" width="22" height="22" decoding="async"></span>`;

/**
 * The flow card: 2-3 steps joined by arrows, exactly as the references show. Each entry is
 * either a token symbol, an icon name, or a short caption. Presentation only — it repeats what
 * the shop already does, it does not decide anything.
 */
const FLOW = {
  hall: [['near', 'NEAR'], ['icon:file-text', 'Parts'], ['tick', 'Review']],
  payouts: [['usdc', 'USDC'], ['near', 'USDC on NEAR']],
  guard: [['near', 'NEAR'], ['icon:zoom', 'Check']],
  arena: [['near', 'NEAR'], ['icon:shield', 'Guardian']],
  ferry: [['near', 'NEAR'], ['usdc', 'USDC']],
  bank: [['icon:file-text', 'Statement'], ['icon:tick', 'Audit']],
  chronicle: [['icon:explorer', 'Account'], ['icon:tick', 'Record']],
  toll: [['near', 'NEAR'], ['icon:link', 'Base']],
  house: [['icon:key', 'Key'], ['icon:file-text', 'Deed']],
};

const step = ([kind, label]) => {
  if (kind.startsWith('icon:')) {
    const name = kind.slice(5);
    return `<span class="flow-step"><img src="${ICON_BASE}/${iconFile(name)}" alt="" width="22" height="22" decoding="async"><span>${label}</span></span>`;
  }
  if (kind === 'tick') return `<span class="flow-step"><span class="flow-tick" aria-hidden="true">✓</span><span>${label}</span></span>`;
  return `<span class="flow-step">${tok(kind, label)}<span>${label}</span></span>`;
};

const iconFile = name => (name === 'tick' ? 'tick' : name) + '-premium.webp';

/** The whole flow card for a shop, or '' when that shop has no flow to show. */
export function flowCard(id) {
  const steps = FLOW[id];
  if (!steps || !steps.length) return '';
  return `<div class="flow-card">${steps.map(step).join('<span class="flow-arrow" aria-hidden="true">→</span>')}</div>`;
}

/** The panel heading, used where a shop renders its own header. */
export const heading = id => badge(id);
