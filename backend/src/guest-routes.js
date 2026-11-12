// Guest account and funder routes. Guest accounts exist on the testnet service only: on mainnet
// every route here is a plain 404, so no visitor is ever created beside the real-money path.
//
// Docs: https://docs.near.org/protocol/accounts-contracts/account-id · https://docs.near.org/protocol/accounts-contracts/access-keys
//       https://docs.near.org/tools/near-api · https://docs.near.org/getting-started/faucet
import { NET } from './config.js';
import { clientIdentity, EGRESS_MULT } from './http-guard.js';
import * as guest from './guest.js';

/** Per-IP per-day counters with a persisted day key, so a restart mid-day does not reset the quota. */
export function dayCounter({ limit, name, now = Date.now, store = new Map() }) {
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  return {
    take(key) {
      const k = day(now()) + '|' + String(key || 'unknown');
      const n = (store.get(k) || 0) + 1;
      store.set(k, n);
      // Trim yesterday's keys so the map cannot grow without bound on a long-lived process.
      const today = day(now());
      if (store.size > 4000) for (const old of store.keys()) if (!old.startsWith(today + '|')) store.delete(old);
      return n > limit ? 'ERR_GUEST_IP_CAP' : null;
    },
    size: () => store.size,
    name,
  };
}

/** One counter shared by every IP: the city's own daily ceiling on new guests. */
export function globalCounter({ limit, now = Date.now }) {
  let day = null;
  let count = 0;
  return () => {
    const t = new Date(now()).toISOString().slice(0, 10);
    if (t !== day) { day = t; count = 0; }
    count += 1;
    return count > limit ? 'ERR_GUEST_DAY_CAP' : null;
  };
}

export function register(app, { limiter, globalCap }) {
  const cfg = guest.guestCfg();
  const perIp = new Map();
  const ipCap = dayCounter({ limit: cfg.perIpDay, name: 'guest-ip', store: perIp });
  const dayCap = globalCounter({ limit: cfg.globalDay });
  // A caller that reaches the service directly can type the visitor-IP header. Its real connecting
  // address then gets its own day bucket at EGRESS_MULT x the per-IP limit, as the other quotas do.
  const egressCap = dayCounter({ limit: cfg.perIpDay * EGRESS_MULT, name: 'guest-egress' });

  app.post('/api/guest/start', limiter(20), async (c) => {
    if (NET !== 'testnet') return c.json({ error: 'not found' }, 404);
    let body;
    try { body = await c.req.json(); } catch { body = null; }
    if (!(await guest.turnstileOk(body?.turnstile))) {
      return c.json({ error: 'ERR_TURNSTILE', why: 'ERR_TURNSTILE', retry: 'Press Try free again.' }, 403);
    }
    const [, ip, egress] = clientIdentity(c);
    const take = (k) => ipCap.take(ip || k) || (egress ? egressCap.take(egress) : null);
    const r = await guest.start(body || {}, { caps: { take, global: () => dayCap() } });
    return c.json(r, r.ok === false && r.status ? r.status : 200);
  });

  app.get('/api/guest/status', limiter(60), async (c) => {
    if (NET !== 'testnet') return c.json({ error: 'not found' }, 404);
    return c.json({ ...(await guest.status()), used_today: { ips: perIp.size } });
  });

  app.post('/api/guest/welcome', limiter(10), async (c) => {
    if (NET !== 'testnet') return c.json({ error: 'not found' }, 404);
    let body;
    try { body = await c.req.json(); } catch { body = null; }
    const account = String(body?.account || '').trim();
    const suffix = cfg.suffix || '';
    if (!suffix || !account.endsWith(suffix)) {
      return c.json({ error: 'ERR_ACCOUNT', why: 'ERR_ACCOUNT', note: 'Only a guest of this city has a crate.' }, 400);
    }
    const r = await guest.welcome(account);
    return c.json(r, r.ok === false && r.status ? r.status : 200);
  });
}

