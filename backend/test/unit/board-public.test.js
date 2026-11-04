import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSeedPlayer, publicPlayers } from '../../src/vault.js';

const row = (player, shared = false) => ({
  hash: 'h-' + player, charter: shared ? 'arena.testnet' : 'c.testnet', owner: shared ? 'arena.testnet' : player,
  kind: 'attack', attack: 'lookalike', tag: player, decision: 'denied', counted: true, shared, server_signed: shared, at: 1,
});

test('public board hides guest accounts and scripted nicknames', () => {
  assert.equal(isSeedPlayer('ncguest-6o6i361q6v.testnet'), true);
  assert.equal(isSeedPlayer('judge-r15'), true);
  assert.equal(isSeedPlayer('live'), true);
  assert.equal(isSeedPlayer('e2e-m1'), true);
  assert.equal(isSeedPlayer('guest'), true);
  assert.equal(isSeedPlayer('lucky-owl-19'), false);
  assert.equal(isSeedPlayer('alice.testnet'), false);
  const pub = publicPlayers([
    row('ncguest-abc.testnet'),
    row('judge-r15', true),
    row('live', true),
    row('lucky-owl-19', true),
    row('alice.testnet'),
  ]);
  assert.equal(pub.hidden, 3);
  assert.deepEqual(pub.players.map(p => p.player).sort(), ['alice.testnet', 'lucky-owl-19']);
  assert.equal(pub.players.every(p => p.network === 'testnet'), true);
});
