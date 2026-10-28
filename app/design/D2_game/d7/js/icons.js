// D7 animated action icons. Drawn by us on a 24-unit grid, stroke = currentColor.
// icon(name) returns an <svg>; play(el) restarts its animation. With reduced motion the icon shows its end state.
const S = (len, d, cls = 'draw', dl = 0) => `<path class="${cls}" style="--len:${len};--dl:${dl}s" d="${d}"/>`;
const DEF = {
  allowed: `<circle class="pulse" cx="12" cy="12" r="9" stroke-opacity=".5"/><circle class="ring" cx="12" cy="12" r="9"/>${S(14, 'M8 12.4l2.7 2.7L16.2 9.4', 'draw', .18)}`,
  refused: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.6" stroke-dasharray="1.6 2.2" stroke-opacity=".6"/>${S(10, 'M9.4 9.4l5.2 5.2', 'draw', .12)}${S(10, 'M14.6 9.4l-5.2 5.2', 'draw', .2)}`,
  escalate: `${S(30, 'M5 14.5v4.5h14v-4.5')}<g class="up">${S(12, 'M12 15.5V4.8', 'draw', .1)}${S(12, 'M7.8 9l4.2-4.2L16.2 9', 'draw', .2)}</g>`,
  freeze: [0, 60, 120].map((a, i) => `<g transform="rotate(${a} 12 12)"><g class="arm" style="--i:${i}"><path d="M12 3v18"/><path d="M9.4 5.4L12 7.6l2.6-2.2M9.4 18.6L12 16.4l2.6 2.2"/></g></g>`).join(''),
  receipt: `<g class="paper"><path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/>${S(8, 'M9 8.5h6', 'draw', .35)}${S(8, 'M9 12h6', 'draw', .45)}${S(5, 'M9 15.5h3.5', 'draw', .55)}</g>`,
  swap: `<g class="a1"><path d="M5 8.5h13.5"/><path d="M15 5l3.5 3.5L15 12"/></g><g class="a2"><path d="M19 15.5H5.5"/><path d="M9 12l-3.5 3.5L9 19"/></g>`,
  send: `<g class="plane"><path d="M20.5 3.5L3.8 10.2l6.6 2.6 2.6 6.6z"/><path d="M20.5 3.5l-10.1 9.3"/></g>`,
};
export const ICONS = Object.keys(DEF);
export function icon(name, { size = 28, title } = {}) {
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  t.setAttribute('viewBox', '0 0 24 24'); t.setAttribute('fill', 'none'); t.setAttribute('stroke', 'currentColor'); t.setAttribute('stroke-width', '1.7');
  t.setAttribute('stroke-linecap', 'round'); t.setAttribute('stroke-linejoin', 'round'); t.setAttribute('class', `d7i d7i--${name}`); t.style.setProperty('--sz', size + 'px');
  if (title) { t.setAttribute('role', 'img'); t.setAttribute('aria-label', title); } else t.setAttribute('aria-hidden', 'true');
  t.innerHTML = DEF[name] || ''; return t;
}
export function play(el) { el.classList.remove('play'); void el.getBoundingClientRect(); el.classList.add('play'); }
export function iconHTML(name, size = 20) { return icon(name, { size }).outerHTML; }
