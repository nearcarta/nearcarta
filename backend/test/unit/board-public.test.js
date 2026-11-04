import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicPlayers, DENIED, isDenied } from '../../src/vault.js';
import { makeApp } from '../../src/app.js';

const row = (player, charter, shared = false) => ({
  hash: 'h-' + player, charter, owner: shared ? 'arena.testnet' : player,
  kind: 'attack', attack: 'lookalike', tag: player, decision: 'denied', counted: true, shared, server_signed: shared, at: 1,
});

test('the denylist names the scripted accounts from the repo', () => {
  for (const id of ['nc-audit-158353.testnet', 'aiprobe', 'fallback-test', 'pooltest', 'redteam']) assert.equal(isDenied(id), true);
  assert.ok(DENIED.size > 20);
});

test('a factory charter appears unless we created that account', () => {
  const visitor = { charter: 'owl.nccharters-1.testnet', owner: 'alice.near' };
  const audit = { charter: 'nc-audit-158353-x3oh.nccharters-17102.testnet', owner: 'nc-audit-158353.testnet' };
  const arena = { charter: 'arena.nccharters-53681.testnet', owner: 'ncarena.testnet', shared: true };
  const attempts = [
    row('nc-audit-158353.testnet', audit.charter),
    row('aiprobe', arena.charter, true),
    row('fallback-test', 'arena.nccharters-85831.testnet', true),
    row('pooltest', 'arenapool1-5plv.nccharters-53836.testnet', true),
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
  const pub = publicPlayers([row('redteam', 'arena.nccharters-53681.testnet', true)], []);
  assert.equal(pub.players.length, 0);
});

test('health names mainnet contracts and the testnet trial', async () => {
  const j = await (await makeApp().request('/api/health', { headers: { 'cf-connecting-ip': '192.0.2.77' } })).json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.network, { contracts: 'mainnet', journey: 'mainnet' });
  assert.equal(j.near.chain_id, 'mainnet');
  assert.equal(j.trial.chain_id, 'testnet');
  assert.equal(j.network.trial, undefined);
  const prev = process.env.NEXT_PUBLIC_MAINNET;
  process.env.NEXT_PUBLIC_MAINNET = '1';
  try {
    const flagged = await (await makeApp().request('/api/health', { headers: { 'cf-connecting-ip': '192.0.2.78' } })).json();
    assert.equal(flagged.near.chain_id, 'mainnet');
    assert.equal(flagged.trial, undefined);
  } finally { if (prev === undefined) delete process.env.NEXT_PUBLIC_MAINNET; else process.env.NEXT_PUBLIC_MAINNET = prev; }
});
