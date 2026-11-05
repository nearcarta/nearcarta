// The town intro: one plan for the 3D story and the 2D fallback.
// A fresh visit plays it. nostory, explore and shop skip it.

export const INTRO_MIN_MS = 20000;

export const INTRO_LINES = [
  'Sundown. Lamps first.',
  'Evening, Lamplighter.',
  'Send 0.001 to shop-moved-pay-here.',
  'The oath said no.',
  '0.001 allowed.',
  'Frozen. I wait for you.',
];

export function introEnabled(search = '') {
  const q = search.startsWith('?') ? search.slice(1) : String(search || '');
  const p = new URLSearchParams(q);
  return !p.has('nostory') && !p.has('explore') && !p.has('shop');
}

export function introLine(elapsedMs) {
  const i = Math.min(INTRO_LINES.length - 1, Math.max(0, Math.floor(elapsedMs / 3500)));
  return INTRO_LINES[i];
}

export function introPanPx(elapsedMs) {
  const t = Math.max(0, Math.min(1, elapsedMs / INTRO_MIN_MS));
  return Math.round(t * 48);
}
