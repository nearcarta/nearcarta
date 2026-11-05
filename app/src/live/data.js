// Live data interface for the shop interiors (design/D8_shops). The interiors import
// D6_dashboards/src/data.js; the host rewrites that one URL to this module. It re-exports the
// design's own sample data and replaces the values we can read live. If the API is down, the
// design's values stay, each still tagged with its own src.
export * from '/live/data.static.js';
import * as S from '/live/data.static.js';
import { shapeCore, shapeClauses, shapeActions, shapeBank } from '/live/shape.js';

const API = (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
// Every read has a deadline: the shop rooms import this module, so a slow read must not hold a room's entry. A read
// that misses it leaves the design's own value (still tagged with its src).
const DEADLINE_MS = 2500;
async function j(path, body) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), DEADLINE_MS);
  try {
    const r = await fetch(API + path, { signal: ac.signal, ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

// All reads at once (no waterfall): /api/chronicle is the guardhouse oath feed, so it needs no deployments read first.
// No shop room reads QUOTE from here (the Ferry room uses shops-live.js), so the dry 1Click quote is not fetched:
// it was the slowest read (1-2.5 s) and held every room's entry.
const [DEP, g, ch, mb] = await Promise.all([
  j('/api/deployments'),
  j('/api/guardhouse'),
  j('/api/chronicle?limit=12'),
  j('/api/mistbank'),
]);
export const QUOTE = S.QUOTE;

export const CORE = shapeCore(DEP, g, S.CORE);

export const CLAUSES = shapeClauses(g, S.CLAUSES);

// Live actions, oldest first. Ids P1..Pn so the interiors can still pick P1.
const acts = shapeActions(ch, S.CORE_TXS);
export const CORE_TXS = acts;

// Mist Bank: a real mainnet shielded payout, its NEAR oath approval, the on-chain commitment
// to the amount (never the amount, salt or viewing key), and live dry Confidential Intents quotes.
export const BANK = shapeBank(mb);
