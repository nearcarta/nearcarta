import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precheck } from '../../../shared/relay/precheck.js';
const M = 10n ** 21n;
const base = { purse: 960n * 10n ** 18n, bag: { 'good:salt': 3 }, rules: { stall_rent: String(M) }, stalls: [], now_ns: 100n, me: 'me' };
test('precheck: an invest larger than the purse is never sent', () => {
  const r = precheck([{ method: 'purse', args: { action: 'invest', amount: String(M), shop: 'ferry' } }], base);
  assert.equal(r.ok, false); assert.equal(r.why, 'ERR_PRECHECK_PURSE');
  assert.equal(precheck([{ method: 'purse', args: { action: 'invest', amount: String(M) } }], { ...base, purse: 2n * M }).ok, true);
});
test('precheck: stall rent needs the rent in the purse and a free stall', () => {
  assert.equal(precheck([{ method: 'stall', args: { stall: 1, action: 'rent' } }], base).why, 'ERR_PRECHECK_PURSE');
  const taken = { ...base, purse: 2n * M, stalls: [{ id: 1, holder: 'other', until: '200' }] };
  assert.equal(precheck([{ method: 'stall', args: { stall: 1, action: 'rent' } }], taken).why, 'ERR_PRECHECK_STALL_TAKEN');
  const expired = { ...taken, stalls: [{ id: 1, holder: 'other', until: '50' }] };
  assert.equal(precheck([{ method: 'stall', args: { stall: 1, action: 'rent' } }], expired).ok, true);
});
test('precheck: selling needs the goods, unless they are gathered in the same batch', () => {
  assert.equal(precheck([{ method: 'sell', args: { good: 'good:salt', qty: 4 } }], base).why, 'ERR_PRECHECK_BAG');
  assert.equal(precheck([{ method: 'sell', args: { good: 'good:salt', qty: 3, keep: true } }, { method: 'purse', args: { action: 'invest', amount: String(M) } }], base).ok, true);
});
