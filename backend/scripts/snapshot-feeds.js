// Deploy step: read the live and retired charter feeds from the box (not rate-limited like Render's egress) and write
// backend/data/feed-snapshots.json with the public ledger built from them, so a fresh container answers a
// stale-but-real feed and ledger at once (retired charters have no agent key, so their snapshot stays complete).
import { writeFileSync } from 'node:fs';
import { chronicleOnce, FEED_MAX, _setSnapshots, feedSnapshot } from '../src/shops.js';
import { ledgerAccounts, ledgerRead } from '../src/app.js';
const { live, history } = ledgerAccounts();
const feeds = {}, at = new Date().toISOString();
for (const a of [...live, ...history]) {
  let v; for (let i = 0; ; i++) { try { v = await chronicleOnce(a, FEED_MAX); break; } catch (e) { if (i >= 2) { v = feedSnapshot(a); console.log(a, v ? 'index busy, kept the previous snapshot' : 'index busy, no snapshot'); break; } await new Promise(r => setTimeout(r, 5000 * (i + 1))); } }
  if (!v) continue;
  v.txs = v.txs.filter(t => !t.error);
  feeds[a] = v; console.log(a, v.txs.length, 'txs');
}
_setSnapshots({ at, feeds });
const ledger = await ledgerRead();
console.log('ledger rows', ledger.rows?.length ?? Object.keys(ledger).join(','));
writeFileSync(new URL('../data/feed-snapshots.json', import.meta.url), JSON.stringify({ at, feeds, ledger }));
process.exit(0);
