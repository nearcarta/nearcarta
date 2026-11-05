// One browser session for the town, setup, and every shop route.
// The wallet still signs. This only remembers who is signed in so a reload or a new route does not forget them.

export const SESSION_KEY = 'nearcarta.setup.v1';

export function readSession(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(SESSION_KEY) || 'null') || {}; }
  catch { return {}; }
}

export function sessionAccount(saved) {
  let row = saved;
  if (typeof saved === 'string') { try { row = JSON.parse(saved); } catch { return null; } }
  const id = typeof row?.accountId === 'string' ? row.accountId.trim().toLowerCase() : '';
  if (!id || id === 'preview.near') return null;
  if (!/^[0-9a-f]{64}$/.test(id) && !/^[a-z0-9][a-z0-9._-]*\.[a-z0-9._-]+$/.test(id)) return null;
  return id;
}

export function readSessionAccount(storage = globalThis.localStorage) {
  return sessionAccount(readSession(storage));
}

const HERO_KEY = 'nearcarta.hero.v1';

export function readHero(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(HERO_KEY) || 'null') || null; }
  catch { return null; }
}

/** The town chip, Town Hall and Mist Bank all read this. A look name is not a sign-in. */
export function visitor(storage = globalThis.localStorage) {
  const saved = readSession(storage);
  const hero = readHero(storage);
  const accountId = sessionAccount(saved) || sessionAccount({ accountId: saved.charter }) || '';
  const displayName = String(saved.displayName || hero?.name || '').trim();
  return { accountId, displayName, balanceNear: saved.balanceNear ?? null, signedIn: !!accountId };
}

/** Merge into the saved setup object. accountId null removes the account. */
export function writeSession(patch, storage = globalThis.localStorage) {
  const cur = readSession(storage);
  const next = { ...cur, ...patch };
  if (patch.accountId == null && Object.prototype.hasOwnProperty.call(patch, 'accountId')) delete next.accountId;
  storage?.setItem(SESSION_KEY, JSON.stringify(next));
  return next;
}

export function clearSessionAccount(storage = globalThis.localStorage) {
  return writeSession({ accountId: null, balanceNear: null }, storage);
}

/** Same-origin path from ?next=. Drops a preview flag so a return never opens the demo row. */
export function nextPath(search = '') {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const n = q.get('next') || '';
  if (!n.startsWith('/') || n.startsWith('//') || n.includes('\\') || n.includes('://')) return null;
  try {
    const u = new URL(n, 'https://nearcarta.local');
    if (u.origin !== 'https://nearcarta.local') return null;
    u.searchParams.delete('preview');
    const out = u.pathname + u.search + u.hash;
    return out.startsWith('/') && !out.startsWith('//') ? out : null;
  } catch { return null; }
}

export function hallRowHref(accountId) {
  if (accountId && accountId !== 'preview.near') return '/shops/hall/?owner=' + encodeURIComponent(accountId);
  return '/setup/?next=' + encodeURIComponent('/shops/hall/');
}

/** One pill everywhere: name, short account, and Fund only when the balance is known and empty. */
export function sessionPill({ accountId, displayName, balanceNear } = {}) {
  if (!accountId) return 'Sign in';
  const name = displayName && displayName !== accountId ? String(displayName) : '';
  const shortId = accountId.length > 22 ? accountId.slice(0, 6) + '…' + accountId.slice(-4) : accountId;
  const who = name ? `${name} · ${shortId}` : shortId;
  if (balanceNear == null || balanceNear === '') return who;
  if (Number(balanceNear) === 0) return `${who} · Fund`;
  return `${who} · ${balanceNear} NEAR`;
}

/** A signed-in visitor is not told to sign in. */
export function signedCopy(accountId, hasCharter) {
  if (!accountId) return { lead: 'Look around first', sub: 'The proof below is already on mainnet.' };
  if (hasCharter) return { lead: 'Signed in', sub: 'Your rules are on this row. The proof below is already on mainnet.' };
  return { lead: 'Signed in', sub: 'The proof below is already on mainnet. Your own rules are set from your row.' };
}

export function tollRefusal(reason) {
  return reason ? `Refused: ${reason}. Nothing was paid.` : 'Refused. Nothing was paid.';
}
