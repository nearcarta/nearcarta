// The loop a player actually feels: a 30-second action, a five-minute day, a whole session, each with
// visible progress and a reward at the end. This pins the shape of that loop and that a finished day pays.
// Docs: https://docs.near.org/protocol/transactions/meta-tx (the gasless path every step uses)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Q from '../../../shared/market/story.js';

const root = new URL('../../../', import.meta.url).pathname;
const read = (p) => readFileSync(root + p, 'utf8');

test('the loop has three lengths and each one ends in something real', () => {
  const city = read('app/src/market/city.js');
  // One action: a single gold button in the shop strip, built by one helper.
  assert.match(city, /const gold = \(act, label/);
  assert.match(city, /gold\('act', s\.btn\)/);
  // One day: nine steps, one per shop, tracked by a ring and a count.
  assert.match(city, /data-testid="md-ring"/);
  assert.match(city, /data-testid="md-reward"/);
  // A session: the Week button and the next-day path both exist.
  assert.match(city, /data-testid="md-week"/);
  // Every step is one transaction: the strip sends exactly one call per press.
  assert.match(city, /real = await GT\.step\(step\.id/);
  assert.match(city, /real = await R\.step\(step\.id/);
});

test('the day has nine steps, one per shop, and every shop appears once', () => {
  assert.equal(Q.STEPS.length, 9);
  const shops = Q.STEPS.map((s) => s.shop);
  assert.equal(new Set(shops).size, shops.length, 'no shop is visited twice');
  for (const s of Q.STEPS) {
    for (const field of ['id', 'shop', 'need', 'btn', 'reward', 'done']) assert.ok(s[field], `${s.id}.${field}`);
  }
});

test('a finished day pays a reward and says what it is', () => {
  const city = read('app/src/market/city.js');
  assert.match(city, /Day \$\{Q\.state\(city\)\.day\} sealed/);
  assert.match(city, /you keep \$\{coins\(coinsEarned\)\} coins/);
  // A guest's reward line says the receipts are on testnet, so the reward is not mistaken for money.
  assert.match(city, /every step is a testnet receipt/);
  // The ring is honest: it tracks the same progress the story does.
  assert.match(city, /pr\.done \/ pr\.total/);
});

test('the progress ring and reward are styled and fit a phone', () => {
  const css = read('app/src/market/market.css');
  assert.match(css, /\.md-ring\{/);
  assert.match(css, /\.md-ring \.fg\{[^}]*#f5d08a/);
  assert.match(css, /\.md-reward\{/);
  // At 390 the ring shrinks rather than pushing the count off the bar.
  assert.match(css, /@media \(max-width:720px\)\{[^}]*\.md-ring\{width:18px/);
});
