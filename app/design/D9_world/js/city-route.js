// One rule for every shop key in the city.
//
// The town has four ways in: the ?shop= deep link, the All shops list, the overview pins and the door
// prompt. They used to carry their own per-shop special cases, and five entries in the All shops list
// had no city key at all, so Mist Bank and Vault Arena left the city for the standalone page and Toll,
// Hall and Payouts each needed a bespoke click handler. A click during the long 3D boot also fell back
// to location.assign because the opener did not exist yet.
//
// Every entry now resolves through shopKey() and opens through one router, which holds the first
// request until the town can actually open a room.

export const SHOP_KEYS = Object.freeze(['ferry', 'payouts', 'bank', 'chronicle', 'guard', 'toll', 'house', 'arena', 'hall']);

const ALIAS = Object.freeze({ chron: 'chronicle', townhall: 'hall', mistbank: 'bank', guardhouse: 'guard', vault: 'house', house: 'house' });

export function shopKey(raw) {
  const k = String(raw || '').trim().toLowerCase();
  const c = ALIAS[k] || k;
  return SHOP_KEYS.includes(c) ? c : null;
}

export function shopHref(raw) {
  const k = shopKey(raw);
  return k ? '/?shop=' + k : null;
}

export function shopQuery(search) {
  try { return shopKey(new URLSearchParams(search || '').get('shop')); } catch { return null; }
}

// open(raw) resolves a key and opens it; before arm() the first request is remembered, not dropped.
// A later request replaces an earlier pending one, so a double click opens the last shop asked for.
export function createRouter({ open } = {}) {
  let pending = null, ready = false;
  const fire = id => { try { open?.(id); } catch (e) { console.warn('[Nearcarta] could not open shop', id, e); } };
  return {
    pending: () => pending,
    armed: () => ready,
    arm() { ready = true; const id = pending; pending = null; if (id) fire(id); return id; },
    open(raw) { const id = shopKey(raw); if (!id) return null; if (!ready) { pending = id; return id; } fire(id); return id; },
  };
}
