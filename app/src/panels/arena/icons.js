// Original stall marks for the arena tray. No remote images and no question-mark placeholders.
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">${body}</svg>`;

const ICONS = {
  potion: svg('<rect x="11" y="3" width="6" height="4" rx="1" fill="#e2b35b"/><path d="M9 8h10l2 4c2 6-1 13-7 13s-9-7-7-13l2-4z" fill="#7fe0b0" stroke="#2a1608" stroke-width="1.2"/><circle cx="13" cy="16" r="1.2" fill="#fff8ee"/>'),
  loaf: svg('<ellipse cx="14" cy="16" rx="10" ry="6" fill="#e2b35b" stroke="#2a1608" stroke-width="1.2"/><path d="M8 15c2-3 10-3 12 0" fill="none" stroke="#8b5e2b" stroke-width="1.4" stroke-linecap="round"/>'),
  blade: svg('<path d="M6 22l4-4 10-10 2 2-10 10-4 4-2-2z" fill="#d6b46a" stroke="#2a1608" stroke-width="1.2"/><path d="M16 6l6 6" stroke="#fff8ee" stroke-width="1.2"/><rect x="4" y="20" width="6" height="3" rx="1" fill="#6b4a33" transform="rotate(-45 7 21)"/>'),
  score: svg('<path d="M14 3l2.4 6.2 6.6.5-5 4.2 1.6 6.4L14 16.8 8.4 20.3 10 13.9 5 9.7l6.6-.5z" fill="#f5d08a" stroke="#2a1608" stroke-width="1.1"/>'),
  seal: svg('<circle cx="14" cy="14" r="9" fill="#a33b32" stroke="#2a1608" stroke-width="1.3"/><circle cx="14" cy="14" r="5" fill="none" stroke="#f3ead8" stroke-width="1.4"/><path d="M14 10v8M10 14h8" stroke="#f3ead8" stroke-width="1.2"/>'),
};

export function arenaIcon(name) {
  const key = String(name || '').toLowerCase();
  if (ICONS[key]) return ICONS[key];
  const letter = (String(name || 'N').trim().slice(0, 1) || 'N').toUpperCase();
  return svg(`<circle cx="14" cy="14" r="11" fill="#1a1410" stroke="#c98f4e" stroke-width="1.6"/><text x="14" y="18" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="#f5d08a">${letter}</text>`);
}
