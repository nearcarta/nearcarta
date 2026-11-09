// The quest step strip: one line, one gold button, the reward. A small shared component that sits directly
// under a shop panel's header. Panels expose a `.shop-quest` slot; until a panel has one, the strip mounts
// at the top of the panel body (after the header block). It never edits the panel itself: if the panel
// re-renders and drops the strip, the observer puts it back.
const SLOT = '.shop-quest';
function host() {
  const tray = document.querySelector('#shopUI #tray') || document.querySelector('#tray');
  if (!tray) return null;
  const slot = tray.querySelector(SLOT);
  if (slot) return { parent: slot, before: null };
  const body = tray.querySelector('.t-scroll') || tray;
  const head = body.querySelector(':scope > .t-head');
  let after = head; // keep the header block together: title, then its label lines
  while (after && after.nextElementSibling && after.nextElementSibling.matches('.t-label, #t-label, .label, #t-who, #t-track')) after = after.nextElementSibling;
  return { parent: body, before: after ? after.nextElementSibling : body.firstElementChild };
}

export function createStrip({ onClick }) {
  const el = document.createElement('div');
  el.className = 'qs'; el.dataset.testid = 'quest-strip'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Market Day step');
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-qs]'); if (b && !b.disabled) onClick(b.dataset.qs, b, e); });
  let obs = null, html = '';
  function place() {
    const h = host(); if (!h) return false;
    if (el.parentElement !== h.parent || (h.before && el.nextElementSibling !== h.before && h.before !== el)) h.parent.insertBefore(el, h.before === el ? el.nextSibling : h.before);
    return true;
  }
  return {
    el,
    show(markup, { gold = false } = {}) {
      if (markup !== html) { el.innerHTML = markup; html = markup; }
      if (!place()) return;
      document.body.classList.add('qs-on'); document.body.classList.toggle('qs-gold', gold);
      obs?.disconnect();
      const tray = document.querySelector('#tray');
      if (tray) { obs = new MutationObserver(() => { if (!el.isConnected || (tray.querySelector(SLOT) && el.parentElement !== tray.querySelector(SLOT))) place(); }); obs.observe(tray, { childList: true, subtree: true }); }
    },
    hide() { obs?.disconnect(); obs = null; el.remove(); html = ''; document.body.classList.remove('qs-on', 'qs-gold'); },
  };
}
