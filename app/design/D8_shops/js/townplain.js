// Town view: plain subtitle under every shop name (map pins, shop menu, 2D pins) + first-visit onboarding.
import { SUB, NAME } from './plain.js';
import { maybeOnboard } from './onboard.js';
import { watch } from './tokens.js';
const BY = Object.fromEntries(Object.entries(NAME).map(([k, v]) => [v, k])); BY.House = 'house';
function fix() {
  for (const b of document.querySelectorAll('#pins .pin')) { const n = b.querySelector('b')?.textContent; const k = BY[n]; const sm = b.querySelector('small'); if (k && sm && sm.textContent !== SUB[k]) sm.textContent = SUB[k]; }
  for (const b of document.querySelectorAll('[data-id]')) { const k = b.dataset.id; const sm = b.querySelector('small'); if (SUB[k] && sm && b.closest('[role=menu],#sm,#fbpins') && sm.textContent !== SUB[k]) sm.textContent = SUB[k]; }
  for (const b of document.querySelectorAll('#fbpins .fbpin')) { const k = b.dataset.id; if (SUB[k] && !b.querySelector('.sub')) { const s = document.createElement('small'); s.className = 'sub'; s.textContent = SUB[k]; (b.querySelector('b') || b).after(s); } }
}
let t = 0; new MutationObserver(() => { clearTimeout(t); t = setTimeout(fix, 80); }).observe(document.body, { childList: true, subtree: true });
fix(); watch(document.getElementById('chron')); setTimeout(maybeOnboard, 1500);
