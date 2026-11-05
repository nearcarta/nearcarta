// Pointer spotlight, magnetic primary buttons, click sparks.
// Transform and opacity only. Idle when the visitor prefers less motion.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const CARDS = '.card, .pick, .tile, .panel, .box, .tot > div, #tray, #chron, .pin .ban, #shopMenu, .ob-card, .fbpin, .pnc-card, main > form, .plan > li, #steps > li';
const MAGNETS = '#rulesBtn, .btn.gold, .act.primary, button.primary, a.primary, #go, a.go, .pill.go, #onboard .ob-next, nav button.on, .nc-sign .pnc-action-button--primary';

function spark(x, y) {
  if (reduced) return;
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('i');
    s.className = 'nc-spark';
    const a = (Math.PI * 2 * i) / 8 + Math.random() * 0.35;
    const d = 16 + Math.random() * 22;
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
    s.style.setProperty('--dy', (Math.sin(a) * d).toFixed(1) + 'px');
    s.style.background = i % 2 ? '#00ec97' : '#8b7cff';
    document.body.appendChild(s);
    s.addEventListener('animationend', () => s.remove(), { once: true });
  }
}

if (!reduced && fine) {
  addEventListener('pointermove', (e) => {
    const card = e.target.closest?.(CARDS);
    if (card) {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--sx', ((e.clientX - r.left) / Math.max(r.width, 1) * 100).toFixed(1) + '%');
      card.style.setProperty('--sy', ((e.clientY - r.top) / Math.max(r.height, 1) * 100).toFixed(1) + '%');
    }
    for (const el of document.querySelectorAll(MAGNETS)) {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const near = Math.hypot(dx, dy) < 90;
      el.style.setProperty('--mx', near ? (dx * 0.16).toFixed(1) + 'px' : '0px');
      el.style.setProperty('--my', near ? (dy * 0.16).toFixed(1) + 'px' : '0px');
    }
  }, { passive: true });
}

addEventListener('click', (e) => {
  const hit = e.target.closest?.('button, .btn, a.primary, a.go, #rulesBtn, .back-town, .act');
  if (!hit) return;
  spark(e.clientX, e.clientY);
});
