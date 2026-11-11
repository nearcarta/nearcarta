// The town intro: one plan for the 3D story and the 2D fallback.
//
// The town IS the game, so the first screen must be playable at once. The cinematic story still
// exists and is still one press away ("Watch the story"), but a first visit lands in the town with the
// gold action already in front of them instead of a 20-second clip they have to skip.
//
// `?story=1` plays it, and so does the story button. `?nostory`, `?explore` and a shop deep link skip it.
// Docs: none (a UI decision); the story text itself is in main.js `story()`.

export const INTRO_MIN_MS = 20000;

/** A fresh visit no longer plays the cinematic: the town is the front door. */
export function introEnabled(search = '') {
  const q = search.startsWith('?') ? search.slice(1) : String(search || '');
  const p = new URLSearchParams(q);
  if (p.has('nostory') || p.has('explore') || p.has('shop')) return false;
  return p.has('story'); // only when asked
}

export const INTRO_LINES = [
  'Sundown. Lamps first.',
  'Evening, Lamplighter.',
  'Send 0.001 to shop-moved-pay-here.',
  'The oath said no.',
  '0.001 allowed.',
  'Frozen. I wait for you.',
];

export function introLine(elapsedMs) {
  const i = Math.min(INTRO_LINES.length - 1, Math.max(0, Math.floor(elapsedMs / 3500)));
  return INTRO_LINES[i];
}

export function introPanPx(elapsedMs) {
  const t = Math.max(0, Math.min(1, elapsedMs / INTRO_MIN_MS));
  return Math.round(t * 48);
}
