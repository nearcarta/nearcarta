// One gate for the FastNEAR tx index (tx.test.fastnear.com), shared by every caller in this process.
// The index rate-limits per IP and Render's egress IP is shared, so callers must not compete blindly:
//  - every request has a deadline (a hung connection once stalled a whole board rebuild);
//  - a 429/5xx sets one shared cooldown (exponential, capped) that every caller waits out, instead of each
//    caller hammering the index on its own schedule;
//  - 'high' callers (a page's chronicle feed) go first: 'low' callers (the board rebuild) wait while any high
//    request is queued or in flight, and give up early so they never hold the IP's quota.
export const INDEX_URL = process.env.FASTNEAR_TX_API || 'https://tx.test.fastnear.com';
const TIMEOUT_MS = Number(process.env.TX_INDEX_TIMEOUT_MS || 8_000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const gate = { until: 0, strikes: 0, high: 0, stats: { calls: 0, ok: 0, busy: 0, timeouts: 0, lowSkipped: 0 } };
export function _reset() { gate.until = 0; gate.strikes = 0; gate.high = 0; for (const k in gate.stats) gate.stats[k] = 0; }

/**
 * POST one index request. `prio` 'high' retries through cooldowns until `deadlineMs`; 'low' tries at most
 * `tries` times and never while a high request is waiting. Throws `tx index busy` (retryable) or `tx index http N`.
 */
export async function indexPost(path, body, { prio = 'low', deadlineMs = prio === 'high' ? Number(process.env.TX_INDEX_HIGH_DEADLINE_MS || 6_000) : 20_000, tries = prio === 'high' ? 6 : 3, f = fetch, now = Date.now, baseMs = 1000 } = {}) {
  const end = now() + deadlineMs;
  let last = 'cooldown';
  if (prio === 'high') gate.high++;
  try {
    for (let i = 0; i < tries; i++) {
      // Wait out the shared cooldown; a low caller also waits for the high queue to drain.
      for (;;) {
        const wait = Math.max(gate.until - now(), prio === 'low' && gate.high > 0 ? 250 : 0);
        if (wait <= 0) break;
        if (now() + wait > end) { if (prio === 'low') gate.stats.lowSkipped++; throw Object.assign(new Error(`tx index busy (${last})`), { busy: true }); }
        await sleep(Math.min(wait, 500));
      }
      gate.stats.calls++;
      let r = null, why = 'unreachable';
      try {
        r = await f(`${INDEX_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.max(1000, Math.min(TIMEOUT_MS, end - now()))) });
        if (r.ok) { const j = await r.json(); gate.strikes = 0; gate.stats.ok++; return j; }
        why = 'http ' + r.status;
        if (r.status !== 429 && r.status < 500) throw Object.assign(new Error('tx index ' + why), { status: 502 });
      } catch (e) {
        if (e.status === 502) throw e;
        if (e.name === 'TimeoutError' || e.name === 'AbortError') { why = 'timeout'; gate.stats.timeouts++; }
      }
      last = why; gate.stats.busy++;
      gate.strikes = Math.min(gate.strikes + 1, 4);
      gate.until = Math.max(gate.until, now() + baseMs * 2 ** (gate.strikes - 1)); // 1, 2, 4, 8 s
      if (now() >= end) break;
    }
    throw Object.assign(new Error(`tx index busy (${last})`), { busy: true });
  } finally { if (prio === 'high') gate.high--; }
}
