// First visit: three short steps (connect, set your rules, try a shop). Skippable; shown once per browser.
import { SUB, NAME } from './plain.js';
import { tokenIcon } from './tokens.js';
const KEY = 'nearcarta.onboarded';
const seen = () => { try { return !!localStorage.getItem(KEY); } catch { return true; } };
const done = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch {} };
const SHOPS = ['toll', 'ferry', 'bank', 'guard', 'arena'];
const STEPS = [
  { t: 'Connect', b: globalThis.NEARCARTA_PUBLIC_MAINNET === true
    ? `Sign in with your NEAR wallet or email. The town runs on NEAR mainnet ${tokenIcon('NEAR')}: tries cost about 0.001 NEAR each, and your charter caps every payment.`
    : `Use your NEAR wallet, or start as a guest with free test funds ${tokenIcon('NEAR')}. No real money.` },
  { t: 'Set your rules', b: 'Your charter sets who your AI helper may pay and how much a day. The chain checks every payment against it.' },
  { t: 'Try a shop', b: '<ul class="ob-shops">' + SHOPS.map(k => `<li><b>${NAME[k]}</b><span>${SUB[k]}</span></li>`).join('') + '</ul>' },
];
export function maybeOnboard() {
  if (seen() || document.getElementById('onboard') || /[?&](e2e|noob)\b/.test(location.search) || navigator.webdriver && !/[?&]ob\b/.test(location.search)) return;
  let i = 0; const d = document.createElement('div'); d.id = 'onboard'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'ob-t');
  const close = () => { done(); d.classList.add('out'); setTimeout(() => d.remove(), 220); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); };
  const paint = () => {
    const s = STEPS[i];
    d.innerHTML = `<div class="ob-card"><button class="ob-skip" type="button" data-testid="ob-skip">Skip</button>
      <p class="ob-n">Step ${i + 1} of 3</p><h2 id="ob-t">${s.t}</h2><div class="ob-b">${s.b}</div>
      <div class="ob-dots">${STEPS.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="ob-nav">${i ? '<button type="button" class="ob-back">Back</button>' : '<span></span>'}
      <button type="button" class="ob-next" data-testid="ob-next">${i < 2 ? 'Next' : 'Start'}</button></div></div>`;
    d.querySelector('.ob-skip').onclick = close;
    d.querySelector('.ob-next').onclick = () => { if (i < 2) { i++; paint(); } else close(); };
    const b = d.querySelector('.ob-back'); if (b) b.onclick = () => { i--; paint(); };
    d.querySelector('.ob-next').focus();
  };
  document.body.appendChild(d); paint(); document.addEventListener('keydown', key);
}
