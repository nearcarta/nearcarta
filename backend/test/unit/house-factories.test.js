// The House finds a guest's charter on every charter factory, newest first (app/house/factories.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { factoriesOf, deedsOn, factoryOfCharter } from '../../../app/house/factories.js';

const vault = JSON.parse(readFileSync(new URL('../../../shared/deployments/testnet.json', import.meta.url))).vault;

test('factoriesOf: the current factory first, then every legacy one from testnet.json', () => {
  assert.deepEqual(factoriesOf(vault), ['nccharters-53836.testnet', 'nccharters-53681.testnet', 'nccharters-85831.testnet', 'nccharters-17102.testnet']);
});
test('factoriesOf: no duplicates, no blanks, fallback when the vault has no factory', () => {
  assert.deepEqual(factoriesOf({ factory: 'a.testnet', legacy: [{ factory: 'a.testnet' }, {}, null, { factory: 'b.testnet' }] }), ['a.testnet', 'b.testnet']);
  assert.deepEqual(factoriesOf(undefined, 'th.testnet'), ['th.testnet']);
  assert.deepEqual(factoriesOf({ legacy: [{ factory: 'old.testnet' }] }, 'th.testnet'), ['th.testnet', 'old.testnet']);
  assert.deepEqual(factoriesOf({}, ''), []);
});
test('deedsOn asks charters_of on every factory and keeps the newest first', async () => {
  const seen = [];
  const reg = { 'new.testnet': ['g-a.new.testnet'], 'old.testnet': ['g-b.old.testnet', 'g-c.old.testnet'], 'older.testnet': [] };
  const view = async (f, m, a) => { seen.push([f, m, a.owner]); return reg[f]; };
  assert.deepEqual(await deedsOn(['new.testnet', 'old.testnet', 'older.testnet'], view, 'g.testnet'), ['g-a.new.testnet', 'g-b.old.testnet', 'g-c.old.testnet']);
  assert.deepEqual(seen, [['new.testnet', 'charters_of', 'g.testnet'], ['old.testnet', 'charters_of', 'g.testnet'], ['older.testnet', 'charters_of', 'g.testnet']]);
});
test('deedsOn: an old-only guest still has a house', async () => {
  const view = async f => (f === 'nccharters-53681.testnet' ? ['ncguest-x-ab.nccharters-53681.testnet'] : []);
  assert.deepEqual(await deedsOn(factoriesOf(vault), view, 'ncguest-x.testnet'), ['ncguest-x-ab.nccharters-53681.testnet']);
});
test('deedsOn: one factory failing (throw or reject) does not hide the others; junk answers are dropped', async () => {
  const view = (f) => { if (f === 'boom.testnet') throw new Error('rpc'); if (f === 'rej.testnet') return Promise.reject(new Error('x')); if (f === 'junk.testnet') return { not: 'a list' }; return ['c.ok.testnet', 7, 'c.ok.testnet']; };
  assert.deepEqual(await deedsOn(['boom.testnet', 'rej.testnet', 'junk.testnet', 'ok.testnet'], view, 'o'), ['c.ok.testnet']);
  assert.deepEqual(await deedsOn([], view, 'o'), []);
});
test('factoryOfCharter: the parent account', () => {
  assert.equal(factoryOfCharter('ncguest-x-ab.nccharters-53681.testnet'), 'nccharters-53681.testnet');
  assert.equal(factoryOfCharter('arena.nccharters-53836.testnet'), 'nccharters-53836.testnet');
});
test('factoriesOf: the vault factory wins over the fallback; non-string entries are dropped', () => {
  assert.deepEqual(factoriesOf({ factory: 'v.testnet' }, 'th.testnet'), ['v.testnet']);
  assert.deepEqual(factoriesOf({ factory: 'v.testnet', legacy: [{ factory: 42 }, { factory: true }] }), ['v.testnet']);
});
test('factoryOfCharter keeps a deeper factory account whole', () => {
  assert.equal(factoryOfCharter('g.nccharters-1.pub.testnet'), 'nccharters-1.pub.testnet');
});
