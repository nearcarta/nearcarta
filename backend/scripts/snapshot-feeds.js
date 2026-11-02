// Deploy step: read the guardhouse oath and arena charter feeds from the box (not rate-limited like Render's
// egress) and write backend/data/feed-snapshots.json, so a fresh container answers a stale-but-real feed at once.
import { writeFileSync } from 'node:fs';
import { DEP } from '../src/config.js';
import { chronicleOnce, FEED_MAX } from '../src/shops.js';
import * as vault from '../src/vault.js';
const accounts = [DEP.guardhouse.oath, vault.config()?.arena?.charter].filter(Boolean);
const feeds = {};
for (const a of accounts) {
  const v = await chronicleOnce(a, FEED_MAX);
  v.txs = v.txs.filter(t => !t.error);
  feeds[a] = v; console.log(a, v.txs.length, 'txs');
}
writeFileSync(new URL('../data/feed-snapshots.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), feeds }));
