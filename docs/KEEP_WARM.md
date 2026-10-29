# Keeping the API warm (free plan)

The API runs on Render's free plan, which spins an instance down after about 15 minutes with no
inbound HTTP traffic; the next request then waits for a cold start.

**What we use:** a self-ping in the backend (`backend/src/keepwarm.js`, started from `server.js`).
Every 10 minutes the process fetches its own public URL (`$RENDER_EXTERNAL_URL/api/health`, which
Render sets automatically). The request goes out through Render's edge and back in, so it counts as
traffic and the instance stays up. It costs nothing, needs no outside service and no new secret.

- Stops by itself after `KEEP_WARM_UNTIL` (default `2026-11-25T23:59:59Z`).
- Turn off with `KEEP_WARM=0`; point elsewhere with `KEEP_WARM_URL`.
- `/api/health` is rate limited per IP (60/min); one call per 10 min is far below that.

**Why not the others:** Vercel Hobby cron runs at most once a day (too rare); GitHub Actions cron is
not available on this repo; outside pinger services would need a new account.

**Limits:** a free instance can still be restarted by Render (deploys, platform maintenance). After a
restart the first ping comes 10 minutes later, so the gap stays well under the 15 minute idle limit.
Free instance hours (750/month) cover one service running the whole month.

**Check:** wait 30+ minutes with no visitors, then `curl -w '%{time_total}\n' -o /dev/null -s https://nearcarta.vercel.app/api/health`; it should answer in under 3 s.
