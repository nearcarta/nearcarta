// The House finds a guest's charter on every charter factory, newest first (app/house/factories.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factoriesOf, deedsOn, factoryOfCharter } from '../../../app/house/factories.js';

const vault = {
  factory: 'nccharters-53836.near',
  legacy: [{ factory: 'nccharters-53681.near' }, { factory: 'nccharters-85831.near' }, { factory: 'nccharters-17102.near' }],
};

test('factoriesOf: the current factory first, then every legacy one', () => {
  assert.deepEqual(factoriesOf(vault), ['nccharters-53836.near', 'nccharters-53681.near', 'nccharters-85831.near', 'nccharters-17102.near']);
});
test('factoriesOf: no duplicates, no blanks, fallback when the vault has no factory', () => {
  assert.deepEqual(factoriesOf({ factory: 'a.near', legacy: [{ factory: 'a.near' }, {}, null, { factory: 'b.near' }] }), ['a.near', 'b.near']);
  assert.deepEqual(factoriesOf(undefined, 'th.near'), ['th.near']);
  assert.deepEqual(factoriesOf({ legacy: [{ factory: 'old.near' }] }, 'th.near'), ['th.near', 'old.near']);
  assert.deepEqual(factoriesOf({}, ''), []);
});
test('deedsOn asks charters_of on every factory and keeps the newest first', async () => {
  const seen = [];
  const reg = { 'new.near': ['g-a.new.near'], 'old.near': ['g-b.old.near', 'g-c.old.near'], 'older.near': [] };
  const view = async (f, m, a) => { seen.push([f, m, a.owner]); return reg[f]; };
  assert.deepEqual(await deedsOn(['new.near', 'old.near', 'older.near'], view, 'g.near'), ['g-a.new.near', 'g-b.old.near', 'g-c.old.near']);
  assert.deepEqual(seen, [['new.near', 'charters_of', 'g.near'], ['old.near', 'charters_of', 'g.near'], ['older.near', 'charters_of', 'g.near']]);
});
test('deedsOn: an old-only guest still has a house', async () => {
  const view = async f => (f === 'nccharters-53681.near' ? ['ncguest-x-ab.nccharters-53681.near'] : []);
  assert.deepEqual(await deedsOn(factoriesOf(vault), view, 'ncguest-x.near'), ['ncguest-x-ab.nccharters-53681.near']);
});
test('deedsOn: one factory failing (throw or reject) does not hide the others; junk answers are dropped', async () => {
  const view = (f) => { if (f === 'boom.near') throw new Error('rpc'); if (f === 'rej.near') return Promise.reject(new Error('x')); if (f === 'junk.near') return { not: 'a list' }; return ['c.ok.near', 7, 'c.ok.near']; };
  assert.deepEqual(await deedsOn(['boom.near', 'rej.near', 'junk.near', 'ok.near'], view, 'o'), ['c.ok.near']);
  assert.deepEqual(await deedsOn([], view, 'o'), []);
});
test('factoryOfCharter: the parent account', () => {
  assert.equal(factoryOfCharter('ncguest-x-ab.nccharters-53681.near'), 'nccharters-53681.near');
  assert.equal(factoryOfCharter('arena.nccharters-53836.near'), 'nccharters-53836.near');
});
test('factoriesOf: the vault factory wins over the fallback; non-string entries are dropped', () => {
  assert.deepEqual(factoriesOf({ factory: 'v.near' }, 'th.near'), ['v.near']);
  assert.deepEqual(factoriesOf({ factory: 'v.near', legacy: [{ factory: 42 }, { factory: true }] }), ['v.near']);
});
test('factoryOfCharter keeps a deeper factory account whole', () => {
  assert.equal(factoryOfCharter('g.nccharters-1.pub.near'), 'nccharters-1.pub.near');
});
