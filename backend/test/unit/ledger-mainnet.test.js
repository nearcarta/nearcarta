import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerAccounts } from '../../src/app.js';
import { ledgerSnapshot } from '../../src/shops.js';
import { MAINNET_DEP } from '../../src/config.js';
import { otherNet, otherEvm, retiredNet } from '../../../shared/net/word-scan.js';

test('ledgerAccounts lists only mainnet charter and arena from mainnet.json', () => {
  const a = ledgerAccounts();
  assert.deepEqual(a.live, [MAINNET_DEP.charter.contract, MAINNET_DEP.extras?.arena?.contract].filter(Boolean));
  assert.deepEqual(a.history, []);
  assert.equal(otherNet.test(JSON.stringify(a)), false);
});

test('ledgerSnapshot ignores an empty feed-snapshots seed', () => {
  // backend/data/feed-snapshots.json has no ledger, so /api/ledger is not seeded from it.
  const snap = ledgerSnapshot();
  assert.equal(snap, null);
});
