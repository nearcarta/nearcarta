# API hosting

The API runs on a paid Render Starter instance, which does not spin down when idle, so the old
free-plan self-ping (`keepwarm.js`) was removed. The backend still pre-warms its caches shortly
after boot (`WARM_DELAY_MS`, default 3 s) and refreshes them every `WARM_EVERY_MS`.
