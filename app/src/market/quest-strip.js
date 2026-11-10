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

// One gold button per view: while the strip carries the gold, any gold action button in the panel steps back to
// outline. Tabs and toggles keep their state colour; only action buttons are demoted, and only while the strip shows.
const tabLike = (e) => e.closest('[role=tablist]') || e.matches('[role=tab],[aria-selected],[aria-pressed],[aria-checked]');
const goldish = (e) => { const s = getComputedStyle(e); const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/; const hit = (c) => { const x = m.exec(c); return x && +x[1] > 200 && +x[2] > 130 && +x[3] < 150; };
  return (s.backgroundImage.includes('gradient') && (s.backgroundImage.match(/rgba?\([^)]*\)/g) || []).some(hit)) || hit(s.backgroundColor); };
function demote(on) {
  const tray = document.querySelector('#tray'); if (!tray) return;
  for (const e of tray.querySelectorAll('.qs-demoted')) if (!on) e.classList.remove('qs-demoted');
  if (!on) return;
  for (const e of tray.querySelectorAll('button, a.act, a.cta, .act, .cta')) { if (e.closest('.qs') || tabLike(e) || e.classList.contains('qs-demoted')) continue; if (goldish(e)) e.classList.add('qs-demoted'); }
}
export function createStrip({ onClick }) {
  const el = document.createElement('div');
  el.className = 'qs tok-done'; // tok-done: the panels' token decorator leaves the strip's own text alone el.dataset.testid = 'quest-strip'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Market Day step');
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
      document.body.classList.add('qs-on'); document.body.classList.toggle('qs-gold', gold); demote(gold); let dt = 0;
      obs?.disconnect();
      const tray = document.querySelector('#tray');
      if (tray) { obs = new MutationObserver(() => { if (!el.isConnected || (tray.querySelector(SLOT) && el.parentElement !== tray.querySelector(SLOT))) place(); clearTimeout(dt); dt = setTimeout(() => demote(document.body.classList.contains('qs-gold')), 80); }); obs.observe(tray, { childList: true, subtree: true }); }
    },
    hide() { obs?.disconnect(); obs = null; el.remove(); html = ''; demote(false); document.body.classList.remove('qs-on', 'qs-gold'); },
  };
}
