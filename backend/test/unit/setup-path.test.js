import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupJourney } from '../../../shared/setup/path.js';

test('the default setup path is mainnet and does not offer the faucet or a charter factory', () => {
  const j = setupJourney(false);
  assert.equal(j.badge, 'mainnet');
  assert.equal(j.guestInTiles, false);
  assert.equal(j.showFaucet, false);
  assert.equal(j.createCharter, false);
  assert.equal(j.explorer, 'https://nearblocks.io');
  assert.match(j.fundLead, /real NEAR/);
  assert.doesNotMatch(j.fundLead, /testnet/i);
  assert.doesNotMatch(j.intentsNote, /faucet/);
});

test('the guest trial is labeled testnet and is the only path that creates a charter', () => {
  const j = setupJourney(true);
  assert.equal(j.badge, 'testnet trial');
  assert.equal(j.guestInTiles, false);
  assert.equal(j.showFaucet, true);
  assert.equal(j.createCharter, true);
  assert.equal(j.explorer, 'https://testnet.nearblocks.io');
  assert.match(j.fundLead, /testnet NEAR/);
});
