// D7 cursor: a quiet ring that trails the pointer and grows over things you can click.
// Only on a fine pointer with hover; off on touch and under reduced motion. Moves with transform only.
// The idea came from cursify.ui-layouts.com; no code was copied (no license was published).
export function cursor({ hot = 'a,button,[role=button],input,label,summary,select,.lb,[data-hot]' } = {}) {
  if (!matchMedia('(pointer:fine) and (hover:hover)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const el = document.createElement('div'); el.className = 'd7-cursor'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el);
  let x = -100, y = -100, tx = x, ty = y, raf = 0;
  const tick = () => { x += (tx - x) * .28; y += (ty - y) * .28; el.style.transform = `translate3d(${x}px,${y}px,0)`; raf = Math.abs(tx - x) + Math.abs(ty - y) > .3 ? requestAnimationFrame(tick) : 0; };
  addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; tx = e.clientX; ty = e.clientY; el.classList.add('on'); el.classList.toggle('hot', !!e.target.closest?.(hot)); if (!raf) raf = requestAnimationFrame(tick); }, { passive: true });
  addEventListener('pointerdown', () => el.classList.add('down')); addEventListener('pointerup', () => el.classList.remove('down'));
  document.addEventListener('pointerleave', () => el.classList.remove('on'));
  return el;
}
