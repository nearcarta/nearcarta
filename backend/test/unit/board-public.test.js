import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicPlayers, DENIED, isDenied } from '../../src/vault.js';
import { makeApp } from '../../src/app.js';
import { otherNet, otherEvm, retiredNet } from '../../../shared/net/word-scan.js';

const row = (player, charter, shared = false) => ({
  hash: 'h-' + player, charter, owner: shared ? 'arena.near' : player,
  kind: 'attack', attack: 'lookalike', tag: player, decision: 'denied', counted: true, shared, server_signed: shared, at: 1,
});

test('the denylist names the scripted accounts from the repo', () => {
  for (const id of ['e2e', 'aiprobe', 'fallback-test', 'pooltest', 'redteam']) assert.equal(isDenied(id), true);
  assert.ok(DENIED.size > 20);
});

test('a factory charter appears unless we created that account', () => {
  const visitor = { charter: 'owl.nccharters-1.near', owner: 'alice.near' };
  const audit = { charter: 'e2e-charter.nccharters-17102.near', owner: 'e2e' };
  const arena = { charter: 'arena.nccharters-53681.near', owner: 'ncarena.near', shared: true };
  const attempts = [
    row('e2e', audit.charter),
    row('aiprobe', arena.charter, true),
    row('fallback-test', 'arena.nccharters-85831.near', true),
    row('pooltest', 'arenapool1-5plv.nccharters-53836.near', true),
    row('redteam', arena.charter, true),
    { ...row('alice.near', visitor.charter), owner: 'alice.near' },
  ];
  const pub = publicPlayers(attempts, [visitor, audit, arena]);
  assert.deepEqual(pub.players.map(p => p.nickname), ['owl']);
  assert.equal(pub.players[0].character, 'owl');
  assert.equal(pub.players[0].score > 0, true);
  assert.ok(pub.players[0].last_tx);
  assert.equal(pub.players.some(p => /aiprobe|pooltest|redteam|audit|fallback/.test(p.nickname)), false);
});

test('an empty factory list is an empty board, not a invented one', () => {
  const pub = publicPlayers([row('redteam', 'arena.nccharters-53681.near', true)], []);
  assert.equal(pub.players.length, 0);
});

test('health names the service network and has no trial block', async () => {
  const j = await (await makeApp().request('/api/health', { headers: { 'cf-connecting-ip': '192.0.2.77' } })).json();
  assert.equal(j.ok, true);
  // The mainnet image says mainnet; the testnet image says testnet. `name` is the service's own network.
  assert.deepEqual(j.network, { name: 'mainnet', contracts: 'mainnet', journey: 'mainnet' });
  assert.equal(j.near.chain_id, 'mainnet');
  assert.equal(j.trial, undefined);
  assert.equal(otherNet.test(JSON.stringify(j)), false);
});
