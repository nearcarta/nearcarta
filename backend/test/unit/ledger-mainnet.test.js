import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerAccounts } from '../../src/app.js';
import { ledgerSnapshot } from '../../src/shops.js';
import { MAINNET_DEP } from '../../src/config.js';

test('ledgerAccounts lists only mainnet charter and arena from mainnet.json', () => {
  const a = ledgerAccounts();
  assert.deepEqual(a.live, [MAINNET_DEP.charter.contract, MAINNET_DEP.extras?.arena?.contract].filter(Boolean));
  assert.deepEqual(a.history, []);
  assert.equal(JSON.stringify(a).toLowerCase().includes('testnet'), false);
});

test('ledgerSnapshot ignores a testnet feed-snapshots seed', () => {
  // backend/data/feed-snapshots.json is a testnet ledger; must not seed /api/ledger.
  const snap = ledgerSnapshot();
  assert.equal(snap, null);
});
