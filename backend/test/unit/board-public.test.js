import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicPlayers, PUBLIC_CHARTERS } from '../../src/vault.js';
import { makeApp } from '../../src/app.js';

const row = (player, charter, shared = false) => ({
  hash: 'h-' + player, charter, owner: shared ? 'arena.testnet' : player,
  kind: 'attack', attack: 'lookalike', tag: player, decision: 'denied', counted: true, shared, server_signed: shared, at: 1,
});

const LIVE = [
  row('nc-audit-158353.testnet', 'nc-audit-158353-x3oh.nccharters-17102.testnet'),
  row('aiprobe', 'arena.nccharters-53681.testnet', true),
  row('fallback-test', 'arena.nccharters-85831.testnet', true),
  row('pooltest', 'arenapool1-5plv.nccharters-53836.testnet', true),
  row('redteam', 'arena.nccharters-53681.testnet', true),
];

test('the public board starts with an empty visitor allowlist', () => {
  assert.equal(PUBLIC_CHARTERS.size, 0);
});

test('scripted players stay off the board unless their charter is listed', () => {
  const none = publicPlayers(LIVE);
  assert.equal(none.players.length, 0);
  assert.equal(none.hidden, 5);
  const visitor = 'owl.nccharters-1.testnet';
  const pub = publicPlayers([...LIVE, row('lucky-owl', visitor)], new Set([visitor]));
  assert.deepEqual(pub.players.map(p => p.player), ['lucky-owl']);
  assert.equal(pub.hidden, 5);
  assert.equal(pub.players[0].network, 'testnet');
});

test('health names mainnet contracts and the testnet trial', async () => {
  const j = await (await makeApp().request('/api/health', { headers: { 'cf-connecting-ip': '192.0.2.77' } })).json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.network, { contracts: 'mainnet', trial: 'testnet' });
});
