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

test('the public mainnet flag hides the guest and opens a charter row only after the board is deployed', () => {
  const off = setupJourney(true, { publicMainnet: true, boardDeployed: false });
  assert.equal(off.badge, 'mainnet');
  assert.equal(off.showGuest, false);
  assert.equal(off.showFaucet, false);
  assert.equal(off.createCharter, false);
  assert.doesNotMatch(off.fundLead, /testnet/i);
  const on = setupJourney(false, { publicMainnet: true, boardDeployed: true });
  assert.equal(on.createCharter, true);
  assert.equal(on.showGuest, false);
  assert.equal(on.badge, 'mainnet');
  assert.equal(setupJourney(false, { publicMainnet: true, factoryDeployed: true }).createCharter, false);
});

test('a trial flag does not open a guest path', () => {
  const j = setupJourney(true);
  assert.equal(j.badge, 'mainnet');
  assert.equal(j.showGuest, false);
  assert.equal(j.showFaucet, false);
  assert.equal(j.createCharter, false);
  assert.equal(j.explorer, 'https://nearblocks.io');
  assert.doesNotMatch(JSON.stringify(j), /testnet/i);
});
