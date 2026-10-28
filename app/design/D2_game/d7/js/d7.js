// D7 kit entry point. Plain ES modules with no build step. Load only what a page uses.
export { hero } from './hero.js';
export { icon, iconHTML, play, ICONS } from './icons.js';
export { loadTokens, chip, tokenIcon, hydrate, symbols, missing } from './tokens.js';
export { ticker } from './ticker.js';
export { cursor } from './cursor.js';
export { audio } from './audio.js';
// Hold to confirm: fires cb after `ms` of continuous press. Keyboard: hold Space or Enter.
export function hold(btn, cb, ms = 650) {
  btn.classList.add('d7-hold'); let t0 = 0, raf = 0;
  const set = v => btn.style.setProperty('--hold', v);
  const tick = () => { const p = Math.min(1, (performance.now() - t0) / ms); set(p); if (p >= 1) { end(); btn.classList.remove('is-done'); void btn.offsetWidth; btn.classList.add('is-done'); cb(); return; } raf = requestAnimationFrame(tick); };
  const start = e => { if (e.type === 'keydown' && (e.repeat || !/^( |Enter)$/.test(e.key))) return; e.preventDefault?.(); t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
  const end = () => { cancelAnimationFrame(raf); set(0); };
  btn.addEventListener('pointerdown', start); btn.addEventListener('keydown', start);
  ['pointerup', 'pointerleave', 'pointercancel', 'keyup', 'blur'].forEach(ev => btn.addEventListener(ev, end));
}
