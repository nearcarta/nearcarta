// Each shop's identity, in one place, inside the one shared panel system.
//
// The reference images give every shop the same header block and the same flow strip, differing
// only in the picture and the words:
//
//   [ tabs ][ tabs ][ tabs ]
//   (badge)  Shop Name                    [illustration]
//            one line of subtitle
//   [ .shop-quest  — another worker mounts the Market Day step here ]
//   [ N → Parts → Review ]   full width, centred, labelled
//
// Icons come from the project's own 3D icon set. Tokens come from the /tokens sprites the shops
// already ship. Nothing is invented: a missing icon falls back to the shop's initial, so a
// missing asset can never break a panel.

const ICON_BASE = '/design/D2_game/d7/assets/3dicons/192';

/** The round badge in the header: the shop's own sign. */
const BADGE = {
  hall: 'file-text',
  payouts: '3d-coin',
  guard: 'zoom',
  arena: 'shield',
  ferry: 'flash',
  bank: 'wallet',
  chronicle: 'explorer',
  toll: 'link',
  house: 'key',
};

/**
 * The 48px illustration on the right of the header. It is deliberately a DIFFERENT picture from
 * the badge: using the same one made the header read as a duplicated icon.
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

/** The reference titles, and the one line under each. */
const TITLE = {
  hall: ['Jobs Shop', 'Post tasks, assign agents, and track results'],
  payouts: ['Invoice Shop', 'Create and send invoices on NEAR'],
  guard: ['Check Shop', 'Verify accounts and payment safety'],
  arena: ['Guardians Shop', 'Manage guardians, pots, and security'],
  ferry: ['Swap Shop', 'Swap tokens on NEAR with the best route'],
  bank: ['Mist Bank', 'Audit a statement and prove the AI is genuine'],
  chronicle: ['Chronicle', 'Read one account’s record on NEAR'],
  toll: ['Toll Bridge', 'Pay a fee to cross between chains'],
  house: ['Your House', 'Hold the deed, vaults, and heirs'],
};

export const titleOf = id => (TITLE[id] || [null, ''])[0];
export const subtitleOf = id => (TITLE[id] || [null, ''])[1];

const art = (name, cls, size) => name
  ? `<img class="${cls}" src="${ICON_BASE}/${name}-premium.webp" alt="" width="${size}" height="${size}" decoding="async">`
  : '';

/** The round badge. Falls back to the shop's initial so a missing icon never breaks a panel. */
export function badge(id, size = 44) {
  if (BADGE[id]) return art(BADGE[id], 'panel-badge', size);
  const letter = String(id || '?').slice(0, 1).toUpperCase();
  return `<span class="panel-badge panel-badge-letter" aria-hidden="true">${letter}</span>`;
}

/** The 48px decorative illustration on the right of the header. */
export const headerArt = id => art(ART[id], 'panel-art', 48);

/**
 * The flow strip: full width, centred, every step labelled. `tok:` is a token sprite, `icon:` an
 * icon from the set, `tick` the review check.
 */
const FLOW = {
  hall: [['tok:near', 'Task'], ['icon:cube', 'Parts'], ['tick', 'Review']],
  payouts: [['tok:usdc', 'Invoice'], ['tok:near', 'Paid on NEAR']],
  guard: [['tok:near', 'Payee'], ['icon:shield', 'Checked']],
  arena: [['tok:near', 'Entry'], ['icon:shield', 'Pot']],
  bank: [['icon:file-text', 'Statement'], ['icon:tick', 'Audit']],
  chronicle: [['icon:explorer', 'Account'], ['icon:tick', 'Record']],
  toll: [['tok:near', 'Fee'], ['icon:link', 'Cross']],
  house: [['icon:key', 'Key'], ['icon:file-text', 'Deed']],
};

function step([kind, label]) {
  let icon = '';
  if (kind.startsWith('tok:')) {
    const sym = kind.slice(4);
    icon = `<img class="flow-icon" src="/tokens/${sym}.svg" alt="" width="24" height="24" decoding="async">`;
  } else if (kind === 'tick') {
    icon = `<span class="flow-tick" aria-hidden="true">✓</span>`;
  } else if (kind.startsWith('icon:')) {
    icon = art(kind.slice(5), 'flow-icon', 24);
  }
  return `<span class="flow-step">${icon}<span class="flow-cap">${label}</span></span>`;
}

/** The whole flow strip for a shop, or '' when that shop has no flow to show. */
export function flowStrip(id) {
  const steps = FLOW[id];
  if (!steps || !steps.length) return '';
  return `<div class="flow-strip" data-testid="flow-strip">${steps.map(step).join('<span class="flow-arrow" aria-hidden="true">→</span>')}</div>`;
}
