// The town intro overlay. The 3D story and the 2D fallback both use this,
// so a missing WebGL path still shows the walk and the speech.

import { INTRO_MIN_MS, introEnabled, introLine, introPanPx } from './intro-plan.js';

export function mountIntro(doc, search) {
  if (!doc?.body || !introEnabled(search) || doc.getElementById('town-intro')) return null;
  const host = doc.createElement('div');
  host.id = 'town-intro';
  host.dataset.testid = 'town-intro';
  host.dataset.minMs = String(INTRO_MIN_MS);
  host.innerHTML = '<div class="walkers" aria-hidden="true"><i></i><i></i><i></i></div><p class="bub" data-testid="intro-line"></p>';
  doc.body.appendChild(host);
  doc.body.classList.add('intro-on');
  const line = host.querySelector('[data-testid=intro-line]');
  const t0 = performance.now();
  let raf = 0;
  let stopped = false;
  const frame = now => {
    if (stopped) return;
    const elapsed = now - t0;
    host.style.setProperty('--pan', introPanPx(elapsed) + 'px');
    if (line) line.textContent = introLine(elapsed);
    if (elapsed >= INTRO_MIN_MS) finish();
    else raf = requestAnimationFrame(frame);
  };
  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    host.remove();
    doc.body.classList.remove('intro-on');
  };
  raf = requestAnimationFrame(frame);
  return {
    minMs: INTRO_MIN_MS,
    stop() {
      if (performance.now() - t0 < INTRO_MIN_MS) return false;
      finish();
      return true;
    },
    skip() { finish(); return true; },
  };
}
