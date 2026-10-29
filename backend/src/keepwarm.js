// Keep the free Render instance awake through judging (see docs/KEEP_WARM.md).
// Render's free plan spins down after ~15 min with no inbound HTTP. Every 10 min this process
// asks its own public URL for /api/health, which goes through Render's edge and counts as traffic.
// Stops by itself after KEEP_WARM_UNTIL (default 2026-11-25 end of day UTC). Off when KEEP_WARM=0.
export function startKeepWarm({ env = process.env, now = () => Date.now(), fetchFn = fetch, every = 10 * 60e3 } = {}) {
  const base = env.KEEP_WARM_URL || env.RENDER_EXTERNAL_URL;
  const until = Date.parse(env.KEEP_WARM_UNTIL || '2026-11-25T23:59:59Z');
  if (env.KEEP_WARM === '0' || !base || !(until > now())) return null;
  const url = base.replace(/\/$/, '') + '/api/health';
  const t = setInterval(() => {
    if (now() > until) { clearInterval(t); console.log('keep-warm: end date reached, stopped'); return; }
    fetchFn(url, { signal: AbortSignal.timeout(20e3) }).catch(() => {});
  }, every);
  t.unref?.();
  return t;
}
