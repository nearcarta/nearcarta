// Market Day icons: one stroke style (1.7, round caps) on a 24 grid, coloured by the caller.
const S = (d, extra = '') => `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
export const ICON = {
  ore: S('<path d="M4 15l4-7 5 2 4-3 3 8-5 4H8z"/><path d="M8 8l2 6 3-4M17 7l-2 8"/>'),
  wood: S('<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="17" cy="12" r="2.2"/><path d="M6 10.5h6M6 13.5h8"/>'),
  herb: S('<path d="M12 21V10"/><path d="M12 13c-4 0-6-3-6-7 4 0 6 3 6 7z"/><path d="M12 11c0-4 2-7 6-7 0 4-2 7-6 7z"/>'),
  salt: S('<path d="M5 18h14l-2-8H7z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/><path d="M10 14h.01M14 14h.01M12 16h.01"/>'),
  tool: S('<path d="M14 6l4 4-9 9-4-4z"/><path d="M14 6l2-2 4 4-2 2"/>'),
  tonic: S('<path d="M10 3h4M10 3v5l-4 8a3 3 0 0 0 3 5h6a3 3 0 0 0 3-5l-4-8V3"/><path d="M8 15h8"/>'),
  share: S('<path d="M4 20V10l8-6 8 6v10z"/><path d="M9 20v-6h6v6"/>'),
  coin: S('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/>'),
  bag: S('<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>'),
  market: S('<path d="M3 9l2-5h14l2 5"/><path d="M4 9v11h16V9"/><path d="M3 9h18M9 20v-6h6v6"/>'),
  quest: S('<path d="M6 3h10l3 3v15H6z"/><path d="M9 9h7M9 13h7M9 17h4"/>'),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: S('<path d="M15 6l-6 6 6 6"/>'),
  dawn: S('<path d="M4 18h16M7 14a5 5 0 0 1 10 0"/><path d="M12 5v3M5 9l2 2M19 9l-2 2"/>'),
  sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'),
  dusk: S('<path d="M4 18h16M8 14a4 4 0 0 1 8 0"/><path d="M12 6v3"/>'),
  night: S('<path d="M20 14a8 8 0 1 1-10-10 6 6 0 0 0 10 10z"/>'),
  star: S('<path d="M12 4l2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  lamp: S('<path d="M9 4h6M12 2v2"/><path d="M8 7h8l1 9H7z"/><path d="M10 16v3h4v-3"/><path d="M12 10v3"/>'),
  send: S('<path d="M4 12l16-8-6 16-2-7z"/>'),
  seal: S('<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  play: S('<path d="M7 5l12 7-12 7z"/>'),
};
export const GOOD_ICON = { 'good:iron': 'ore', 'good:timber': 'wood', 'good:herb': 'herb', 'good:salt': 'salt', 'item:tool': 'tool', 'item:tonic': 'tonic' };
export const iconFor = (token) => ICON[GOOD_ICON[token] || (token.startsWith('share:') ? 'share' : 'coin')];
