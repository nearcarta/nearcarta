import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callsFor, limits } from '../../src/merchant.js';
const M = 10n ** 21n;
const c = { runsPerDay: 60, floor: 5n * M, maxTgas: 45 };
test('merchant: the three real story moves, built the same way as a signed-in visitor\'s', () => {
  assert.deepEqual(callsFor('cargo').calls.map((x) => x.method), ['gather', 'gather', 'gather']);
  const s = callsFor('sell', { bag: 5, quote: 400n * 10n ** 18n }).calls[0];
  assert.equal(s.args.qty, 3); assert.equal(s.args.keep, true); assert.equal(s.args.min_total, String(960n * 10n ** 18n));
  assert.equal(callsFor('sell', { bag: 0 }).why, 'ERR_MERCHANT_BAG');
  assert.equal(callsFor('invest', { purse: M - 1n }).why, 'ERR_MERCHANT_PURSE');
  assert.equal(callsFor('invest', { purse: 2n * M }).calls[0].args.amount, String(M));
  assert.equal(callsFor('pay').why, 'ERR_STEP');
});
test('merchant: runs a day from the on-chain gather count, a gas cap per move, a relayer floor', () => {
  const cargo = callsFor('cargo').calls;
  assert.equal(limits({ step: 'cargo', calls: cargo, gathersToday: 177, relayerYocto: 50n * M }, c), null);
  assert.equal(limits({ step: 'cargo', calls: cargo, gathersToday: 178, relayerYocto: 50n * M }, c), 'ERR_MERCHANT_DAILY');
  assert.equal(limits({ step: 'sell', calls: [{ tgas: 300 }], gathersToday: 0, relayerYocto: 50n * M }, c), 'ERR_MERCHANT_GAS_CAP');
  assert.equal(limits({ step: 'invest', calls: [{ tgas: 20 }], gathersToday: 0, relayerYocto: 4n * M }, c), 'ERR_MERCHANT_FLOOR');
});
