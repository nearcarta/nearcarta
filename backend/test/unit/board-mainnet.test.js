import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judgePropose, shopOf } from '../../src/board-tx.js';
import { mainnetChronicle } from '../../src/board-chronicle.js';
import { previewPayee } from '../../src/board-guard.js';
import { srcBadge } from '../../../app/design/D8_shops/js/badge.js';
import { NAME as shopNames } from '../../../app/design/D8_shops/js/names.js';
import { NAME as plainNames } from '../../../app/design/D8_shops/js/plain.js';
import { sessionAccount, tollRefusal } from '../../../app/design/D8_shops/js/session.js';
import { makeApp } from '../../src/app.js';
import { otherNet, otherEvm, retiredNet } from '../../../shared/net/word-scan.js';

const y = n => (BigInt(n) * 10n ** 21n).toString();

function tx(receiver, amount, { fail = null, signer = 'visitor.near' } = {}) {
  return {
    transaction: {
      signer_id: signer, receiver_id: 'board.nearcarta.near',
      actions: [{ FunctionCall: { method_name: 'propose', args: Buffer.from(JSON.stringify({ owner: signer, receiver, amount })).toString('base64') } }],
    },
    receipts: fail ? [] : [{ receiver_id: receiver, receipt: { Action: { actions: [{ Transfer: { deposit: amount } }] } } }],
    receipts_outcome: fail ? [{ outcome: { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: fail } } } } } } }] : [],
    status: fail ? { Failure: {} } : { SuccessValue: '' },
  };
}

test('an allowed propose names the shop from the payee', () => {
  const j = judgePropose(tx('toll.nearcarta.near', y(1)));
  assert.equal(j.decision, 'allowed');
  assert.equal(j.shop, 'toll');
  assert.equal(shopOf('charter.nearcarta.near'), 'charter');
});

test('a refusal keeps the reason and pays nothing', () => {
  const j = judgePropose(tx('shop-moved-pay-here.near', y(1), { fail: 'receiver_not_allowlisted' }));
  assert.equal(j.decision, 'refused');
  assert.equal(j.reason, 'receiver_not_allowlisted');
  assert.equal(j.shop, 'shop-moved-pay-here');
});

test('an amount over 0.005 is rejected before it is called allowed', () => {
  const j = judgePropose(tx('toll.nearcarta.near', y(6)));
  assert.equal(j.ok, false);
});

test('chronicle rows link nearblocks and take the shop from the payee', () => {
  const c = mainnetChronicle();
  assert.ok(c.txs.length >= 3);
  assert.ok(c.txs.every(t => t.url.startsWith('https://nearblocks.io/txns/')));
  assert.equal(c.txs.some(t => t.shop === 'chronicle'), false);
  const one = mainnetChronicle('8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8');
  assert.ok(one.txs.every(t => t.signer.startsWith('8e20273e')));
  assert.equal(otherNet.test(JSON.stringify(c)), false);
});

test('a payee off the list is a preview refusal', () => {
  const row = { receivers: ['toll.nearcarta.near'], sealed: true };
  const yes = previewPayee(row, 'toll.nearcarta.near');
  const no = previewPayee(row, 'stranger.near');
  assert.equal(yes.decision, 'would allow');
  assert.equal(yes.preview, true);
  assert.match(yes.seal_note, /preview/);
  assert.equal(no.reason, 'receiver_not_allowlisted');
  assert.match(no.label, /payee not on your list/);
});

test('the recorded house deed payments are the allow and the refusal', () => {
  const house = JSON.parse(readFileSync(new URL('../../../shared/deployments/mainnet.json', import.meta.url), 'utf8')).extras.house;
  assert.equal(house.contract, 'house.nearcarta.near');
  assert.equal(house.txs['house_pay_allowed_0.001'], '83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26');
  assert.equal(house.txs['house_pay_refused_0.002'], '3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1');
  assert.equal(house.txs['house_mint_deed_cap_0.001'], 'FqYcLtmLb7WM9vo83iMNyfSMiMnifSMLQJPJHwBzLtnu');
});

test('shop name maps match, a refusal fits 140 characters, and the session stores one account', () => {
  assert.deepEqual(shopNames, plainNames);
  assert.equal(shopNames.house, 'Your House');
  assert.equal(shopNames.arena, 'Vault Arena');
  const line = tollRefusal('payee not on your list');
  assert.ok(line.length <= 140);
  assert.match(line, /Nothing was paid/);
  assert.equal(sessionAccount('{"accountId":"visitor.near"}'), 'visitor.near');
  assert.equal(sessionAccount('{"accountId":"nope"}'), null);
});

test('a row that names the old network does not wear a mainnet badge', () => {
  assert.equal(srcBadge({ src: 'mainnet', srcNote: 'paid on ' + otherNet.source }), '');
  assert.equal(srcBadge({ src: 'split', url: 'https://nearblocks.io/txns/8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR' }), 'mainnet');
});

test('guest and the old send queue are not routes', async () => {
  const app = makeApp();
  const ip = { 'cf-connecting-ip': '192.0.2.40' };
  for (const path of ['/api/guest', '/api/mistbank/send']) {
    const r = await app.request(path, { headers: ip });
    assert.equal(r.status, 404, path);
  }
});
