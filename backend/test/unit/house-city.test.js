import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planHouseLine, runHouseTurn, yoctoFromNear } from '../../../app/src/panels/house-agent.js';
import { derivationRequest, readDerivedKey } from '../../../app/src/house-derive.js';
import { TOLL_ADDRESS, TOLL_KEY } from '../../../app/src/toll-derive.js';
import { derivedFor, lineFor } from '../../src/house-views.js';

const row = (patch = {}) => ({
  receivers: ['toll.nearcarta.near'],
  per_action_cap: yoctoFromNear('0.005'),
  daily_budget: yoctoFromNear('0.02'),
  min_amount: yoctoFromNear('0.001'),
  balance: yoctoFromNear('0.05'),
  spent_today: '0',
  frozen: false,
  expires_at: '0',
  ...patch,
});

test('a missed house line does not sign', () => {
  assert.equal(planHouseLine('').ok, false);
  assert.match(planHouseLine('').hint, /Pay 0\.001/);
  assert.equal(planHouseLine('hello').ok, false);
  assert.match(planHouseLine('hello').hint, /Pay 0\.001/);
  const check = planHouseLine('Check in');
  assert.equal(check.ok, true);
  assert.equal(check.action, 'checkin');
  assert.equal(check.signed, false);
  assert.match(check.hint, /1 yocto/);
  assert.match(check.hint, /Nothing was signed/);
  assert.equal(planHouseLine('Show my ETH derived address').action, 'derive');
  assert.equal(planHouseLine('Show the purse').tab, 'purse');
  const purse = planHouseLine('Pay 0.001 from the purse');
  assert.equal(purse.action, 'purse-pay');
  assert.equal(purse.seal, true);
  assert.equal(purse.signed, false);
  const deed = planHouseLine('Pay 0.001 NEAR from my deed');
  assert.equal(deed.action, 'purse-pay');
  assert.equal(deed.signed, false);
});

test('a house pay over the cap is refused before any signature', () => {
  const plan = planHouseLine('Pay 0.01 NEAR to toll.nearcarta.near', {
    row: row({ receivers: ['toll.nearcarta.near', 'a.near'] }),
  });
  assert.equal(plan.action, 'refuse');
  assert.equal(plan.seal, true);
  assert.match(plan.hint, /over your cap/);
  assert.notEqual(plan.action, 'propose');
});

test('a charter pay is asked only when the cap holds it', async () => {
  const good = planHouseLine('Pay 0.001 NEAR to toll.nearcarta.near', { row: row() });
  assert.equal(good.action, 'propose');
  assert.equal(good.amountY, yoctoFromNear('0.001'));
  assert.equal(good.receiver, 'toll.nearcarta.near');
  assert.equal(good.seal, false);
  const stranger = planHouseLine('Pay 0.001 NEAR to stranger.near', { row: row() });
  assert.equal(stranger.action, 'refuse');
  assert.match(stranger.hint, /not on your row/);
  const two = planHouseLine('Pay 0.001 NEAR', { row: row({ receivers: ['a.near', 'b.near'] }) });
  assert.equal(two.ok, false);
  assert.match(two.hint, /Name who/);
  const one = planHouseLine('Pay 0.001 NEAR', { row: row({ receivers: ['toll.nearcarta.near'] }) });
  assert.equal(one.receiver, 'toll.nearcarta.near');
  const house = planHouseLine('Pay 0.001 from the house', { row: row({ receivers: ['toll.nearcarta.near'] }) });
  assert.equal(house.action, 'propose');
  assert.equal(house.receiver, 'toll.nearcarta.near');
  assert.match(planHouseLine('Pay 0.001 NEAR to toll.nearcarta.near', { row: row({ frozen: true }) }).hint, /frozen/);
  assert.match(planHouseLine('Pay 0.001 NEAR to toll.nearcarta.near', {}).hint, /\/setup/);
  let asked = 0;
  let delivered = 0;
  const out = await runHouseTurn('Pay 0.001 NEAR to toll.nearcarta.near', {
    row: row(),
    ask: async (receiver, amountY) => {
      asked += 1;
      assert.equal(receiver, 'toll.nearcarta.near');
      assert.equal(amountY, yoctoFromNear('0.001'));
      return { decision: 'allowed', tx: 'ABC' };
    },
    onDelivered: () => { delivered += 1; },
  });
  assert.equal(asked, 1);
  assert.equal(delivered, 1);
  assert.equal(out.success, true);
  assert.equal(out.tx, 'ABC');
});

test('a chain refusal does not play the success beat', async () => {
  let delivered = 0;
  let sealed = 0;
  const out = await runHouseTurn('Pay 0.001 NEAR to toll.nearcarta.near', {
    row: row(),
    ask: async () => ({ decision: 'denied', reason: 'over_per_action_cap', tx: 'DEF' }),
    onDelivered: () => { delivered += 1; },
    showSeal: () => { sealed += 1; },
  });
  assert.notEqual(out.success, true);
  assert.equal(delivered, 0);
  assert.equal(sealed, 1);
  assert.equal(out.tx, 'DEF');
});

test('check-in does not ask the charter', async () => {
  let asked = 0;
  const out = await runHouseTurn('Check in', { ask: async () => { asked += 1; return { decision: 'allowed', tx: 'NO' }; } });
  assert.equal(asked, 0);
  assert.equal(out.action, 'checkin');
  assert.equal(out.signed, false);
});

test('an eth key becomes the toll address method', () => {
  assert.equal(readDerivedKey(TOLL_KEY, 'eth').address, TOLL_ADDRESS);
  assert.equal(readDerivedKey(TOLL_KEY, 'btc').address, null);
});

test('the signer view is domain 0 for both paths', async () => {
  const eth = derivationRequest('alice.near', 'eth');
  assert.equal(eth.path, 'alice.near-eth-1');
  assert.equal(eth.domain_id, 0);
  assert.equal(eth.account, 'v1.signer');
  assert.equal(eth.method, 'derived_public_key');
  assert.equal(eth.predecessor, 'alice.near');
  const btc = derivationRequest('alice.near', 'btc');
  assert.equal(btc.path, 'alice.near-btc-1');
  assert.equal(btc.domain_id, 0);
  const body = await derivedFor('alice.near', async () => TOLL_KEY);
  assert.equal(body.rows[0].address, TOLL_ADDRESS);
  assert.equal(body.rows[1].address, null);
  assert.equal(body.rows[0].predecessor, 'alice.near');
});

test('a missing inheritance view is not a live line', async () => {
  const missing = await lineFor('alice.near', 'house.nearcarta.near', async () => { throw new Error('MethodNotFound'); });
  assert.equal(missing.live, false);
  assert.equal(missing.line, null);
  assert.match(missing.why, /house_line/);
  const live = await lineFor('alice.near', 'house.nearcarta.near', async () => ({ last_check_in_ns: '1' }));
  assert.equal(live.live, true);
  assert.equal(live.line.last_check_in_ns, '1');
  const src = readFileSync(new URL('../../../contracts/house_nft/src/lib.rs', import.meta.url), 'utf8');
  for (const name of ['house_check_in', 'house_cancel_release', 'house_guardian_approve', 'house_release', 'purses still hold NEAR']) {
    assert.match(src, new RegExp(name));
  }
});
