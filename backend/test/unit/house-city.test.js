import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planHouseLine, runHouseTurn, yoctoFromNear } from '../../../app/src/panels/house-agent.js';
import { derivationRequest, readDerivedKey, HOUSE_CONTRACT } from '../../../app/src/house-derive.js';
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

const vault = {
  chain: 'base',
  asset: 'ETH',
  max_value: '0.01',
  max_gas: 100000,
  receivers: ['0xabc'],
};

test('a missed house line does not sign', () => {
  assert.equal(planHouseLine('').ok, false);
  assert.match(planHouseLine('').hint, /Pay 0\.001/);
  assert.equal(planHouseLine('hello').ok, false);
  assert.match(planHouseLine('hello').hint, /Pay 0\.001/);
  const check = planHouseLine("I'm alive");
  assert.equal(check.ok, true);
  assert.equal(check.action, 'checkin');
  assert.equal(check.signed, false);
  assert.equal(check.live, false);
  assert.match(check.hint, /1 yocto/);
  assert.match(check.hint, /Nothing was signed/);
  assert.equal(planHouseLine('Show my ETH derived address').action, 'derive');
  assert.equal(planHouseLine('Show the purse').tab, 'vaults');
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
  const foreign = planHouseLine('Send 0.02 ETH on Base to 0xabc', { vault });
  assert.equal(foreign.action, 'refuse');
  assert.match(foreign.hint, /vault cap/);
  assert.equal(foreign.signed, false);
});

test('a charter pay is not a spend from the house', async () => {
  const good = planHouseLine('Pay 0.001 NEAR to toll.nearcarta.near', { row: row() });
  assert.equal(good.action, 'blocked');
  assert.equal(good.amountY, yoctoFromNear('0.001'));
  assert.equal(good.receiver, 'toll.nearcarta.near');
  assert.equal(good.live, false);
  const stranger = planHouseLine('Pay 0.001 NEAR to stranger.near', { row: row() });
  assert.equal(stranger.action, 'refuse');
  assert.match(stranger.hint, /not on your row/);
  const two = planHouseLine('Pay 0.001 NEAR', { row: row({ receivers: ['a.near', 'b.near'] }) });
  assert.equal(two.ok, false);
  assert.match(two.hint, /Name who/);
  const one = planHouseLine('Pay 0.001 NEAR', { row: row({ receivers: ['toll.nearcarta.near'] }) });
  assert.equal(one.receiver, 'toll.nearcarta.near');
  assert.equal(one.action, 'blocked');
  const house = planHouseLine('Pay 0.001 from the house', { row: row({ receivers: ['toll.nearcarta.near'] }), vault });
  assert.equal(house.action, 'prepare');
  assert.equal(house.live, false);
  assert.match(planHouseLine('Pay 0.001 NEAR to toll.nearcarta.near', { row: row({ frozen: true }) }).hint, /frozen/);
  assert.match(planHouseLine('Pay 0.001 NEAR to toll.nearcarta.near', {}).hint, /\/setup/);
  let asked = 0;
  let delivered = 0;
  const seen = new Set();
  const out = await runHouseTurn('Send 0.001 ETH on Base to 0xabc', {
    vault,
    seen,
    ask: async () => { asked += 1; return { decision: 'allowed', tx: 'ABC' }; },
    onDelivered: () => { delivered += 1; },
  });
  const again = await runHouseTurn('Send 0.001 ETH on Base to 0xabc', {
    vault, seen, ask: async () => { asked += 1; return { decision: 'allowed', tx: 'ABC' }; },
  });
  assert.equal(asked, 0);
  assert.equal(delivered, 0);
  assert.equal(out.label, 'prepared');
  assert.equal(out.live, false);
  assert.equal(again.idempotent, true);
});

test('a chain refusal does not play the success beat', async () => {
  let delivered = 0;
  let sealed = 0;
  const out = await runHouseTurn('Send 0.02 ETH on Base to 0xabc', {
    vault,
    ask: async () => ({ decision: 'denied', reason: 'over_per_action_cap', tx: 'DEF' }),
    onDelivered: () => { delivered += 1; },
    showSeal: () => { sealed += 1; },
  });
  assert.notEqual(out.success, true);
  assert.equal(out.live, false);
  assert.equal(delivered, 0);
  assert.equal(sealed, 1);
  assert.equal(out.label, 'refused');
});

test('check-in does not ask the charter', async () => {
  let asked = 0;
  const out = await runHouseTurn("I'm alive", { ask: async () => { asked += 1; return { decision: 'allowed', tx: 'NO' }; } });
  assert.equal(asked, 0);
  assert.equal(out.action, 'checkin');
  assert.equal(out.signed, false);
  assert.equal(out.label, 'blocked');
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
  assert.equal(eth.predecessor, HOUSE_CONTRACT);
  assert.equal(eth.live, false);
  const btc = derivationRequest('alice.near', 'btc');
  assert.equal(btc.path, 'alice.near-btc-1');
  assert.equal(btc.domain_id, 0);
  assert.equal(btc.predecessor, HOUSE_CONTRACT);
  const body = await derivedFor('alice.near', async () => TOLL_KEY);
  assert.equal(body.rows[0].address, TOLL_ADDRESS);
  assert.equal(body.rows[1].address, null);
  assert.equal(body.rows[0].predecessor, HOUSE_CONTRACT);
  assert.equal(body.live, false);
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
  for (const name of [
    'house_check_in', 'house_cancel_release', 'house_guardian_approve', 'house_release',
    'purses still hold NEAR', 'house_session_prepare_send', 'bitcoin is signing only',
    'a foreign vault still holds value', 'owner intent required',
  ]) {
    assert.match(src, new RegExp(name));
  }
});

test('bitcoin value is refused and a waiting release is a simulation', () => {
  const btc = planHouseLine('Send 1 BTC to bc1qexample', {
    vault: { chain: 'btc', asset: 'BTC', max_value: '1', max_gas: 0, receivers: ['bc1qexample'] },
  });
  assert.equal(btc.action, 'refuse');
  assert.match(btc.hint, /signing only/);
  const sign = planHouseLine('Send 0 BTC to bc1qexample', {
    vault: { chain: 'btc', asset: 'BTC', max_value: '1', max_gas: 0, receivers: ['bc1qexample'] },
  });
  assert.equal(sign.label, 'prepared');
  assert.equal(sign.value, '0');
  assert.equal(sign.live, false);
  const cancel = planHouseLine('Cancel the release', { line: { line: { pending_ns: '9' } } });
  assert.equal(cancel.label, 'simulation');
  assert.equal(cancel.signed, false);
  const none = planHouseLine('Cancel the release', { line: { live: false, line: null } });
  assert.equal(none.label, 'blocked');
});
