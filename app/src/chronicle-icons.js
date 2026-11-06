// Inline marks for the ledger. Unknown shops use the scroll, never a question mark.

const svg = (body) => `<svg class="c-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  allowed: svg('<path d="M5 12.5 9.2 17 19 7"/>'),
  denied: svg('<path d="M7 7l10 10M17 7 7 17"/>'),
  scroll: svg('<path d="M7 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3V7a3 3 0 0 1 3-3z"/><path d="M8 4v13"/>'),
  toll: svg('<path d="M4 18V6M8 18V10M12 18V8M16 18v-5M20 18V4"/>'),
  ferry: svg('<path d="M3 15h18l-2 4H5z"/><path d="M6 15V9h8l4 6"/>'),
  guard: svg('<path d="M12 3 5 6v6c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6z"/>'),
  payouts: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5c.6-1 4.4-1 5 .8s-4.2 1.4-4.6 2.6 4.2 1.4 5 .2"/>'),
  house: svg('<path d="M4 11 12 4l8 7"/><path d="M7 10.5V20h10v-9.5"/>'),
  board: svg('<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  hall: svg('<path d="M4 20h16M6 20V9l6-4 6 4v11"/>'),
  arena: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
  bank: svg('<path d="M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M3 18h18M12 4l9 6H3z"/>'),
  chronicle: svg('<path d="M7 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3V7a3 3 0 0 1 3-3z"/>'),
  model: svg('<rect x="6" y="7" width="12" height="10" rx="2"/><path d="M9 7V5h6v2"/>'),
  feed: svg('<path d="M5 7h14M5 12h14M5 17h10"/>'),
  export: svg('<path d="M12 4v10"/><path d="M8 10l4 4 4-4"/><path d="M5 19h14"/>'),
  verify: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-3.5-3.5"/>'),
};

export function iconFor(shop, decision) {
  const id = String(shop || '').toLowerCase();
  const mark = decision === 'denied' || decision === 'failed' ? ICONS.denied : ICONS.allowed;
  return mark + (ICONS[id] || ICONS.scroll);
}
