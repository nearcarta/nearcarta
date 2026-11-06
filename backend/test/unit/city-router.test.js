// The city router: one key for every shop, one request queue while the town boots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOP_KEYS, shopKey, shopHref, shopQuery, createRouter } from '../../../app/design/D9_world/js/city-route.js';

test('the router knows exactly the nine shop keys', () => {
  assert.deepEqual([...SHOP_KEYS].sort(), ['arena', 'bank', 'chronicle', 'ferry', 'guard', 'hall', 'house', 'payouts', 'toll']);
});

for (const id of SHOP_KEYS) {
  test(`?shop=${id} resolves to ${id} and deep-links back to it`, () => {
    assert.equal(shopQuery(`?shop=${id}`), id);
    assert.equal(shopHref(id), `/?shop=${id}`);
  });
}

test('the old names still open the right room', () => {
  assert.equal(shopKey('chron'), 'chronicle');
  assert.equal(shopKey('townhall'), 'hall');
  assert.equal(shopKey('mistbank'), 'bank');
  assert.equal(shopKey('guardhouse'), 'guard');
  assert.equal(shopKey('vault'), 'house');
  assert.equal(shopQuery('?shop=TownHall'), 'hall');
});

test('an unknown or empty key opens nothing', () => {
  assert.equal(shopKey('nope'), null);
  assert.equal(shopKey(''), null);
  assert.equal(shopKey(null), null);
  const route = createRouter({ open: () => assert.fail('must not open') });
  route.arm();
  assert.equal(route.open('nope'), null);
  assert.equal(route.open(''), null);
});

test('a request made before the town is ready is held, then opened once', () => {
  const opened = [];
  const route = createRouter({ open: id => opened.push(id) });
  route.open('bank');
  assert.deepEqual(opened, [], 'nothing opens before arm()');
  assert.equal(route.pending(), 'bank');
  route.arm();
  assert.deepEqual(opened, ['bank']);
  assert.equal(route.pending(), null, 'the held request is released only once');
  route.open('arena');
  assert.deepEqual(opened, ['bank', 'arena']);
});

test('a second request before boot replaces the first', () => {
  const opened = [];
  const route = createRouter({ open: id => opened.push(id) });
  route.open('hall');
  route.open('toll');
  route.arm();
  assert.deepEqual(opened, ['toll']);
});

test('arm() with nothing held opens nothing', () => {
  let n = 0;
  const route = createRouter({ open: () => n++ });
  route.arm();
  assert.equal(n, 0);
  assert.equal(route.armed(), true);
});
