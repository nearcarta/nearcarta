import test from 'node:test';
import assert from 'node:assert/strict';
import { pickShared, sharedCharters, isShared } from '../../src/vault.js';

const clause = { daily_budget: '100000000000000000000000', max_actions_per_day: 4 };
const fake = usage => async (c, m) => m === 'get_clauses' ? (usage[c] === 'gone' ? Promise.reject(new Error('x')) : { pay: clause }) : usage[c];

test('pool: mainnet has no shared vault charters', () => {
  assert.deepEqual(sharedCharters(), []);
  assert.equal(isShared('arenapool0-19es.nccharters-22195.near'), false);
});

test('pool: an exhausted charter is skipped for the one with the most payments left', async () => {
  const u = { a: { count: 4, spent: '0' }, b: { count: 1, spent: '0' }, c: { count: 2, spent: '0' } };
  assert.equal(await pickShared(fake(u), ['a', 'b', 'c'], (k, ms, f) => f()), 'b');
});
test('pool: ties go to more budget left; unreadable charters are skipped', async () => {
  const u = { a: 'gone', b: { count: 1, spent: '50000000000000000000000' }, c: { count: 1, spent: '1' } };
  assert.equal(await pickShared(fake(u), ['a', 'b', 'c'], (k, ms, f) => f()), 'c');
});
test('pool: nothing readable falls back to the first charter', async () => {
  assert.equal(await pickShared(async () => { throw new Error('down'); }, ['a', 'b'], (k, ms, f) => f()), 'a');
});
test('pool: stops at the first charter with its whole day left', async () => {
  const seen = []; const v = async (c, m) => { seen.push(c + m); return m === 'get_clauses' ? { pay: clause } : { count: 0, spent: '0' }; };
  assert.equal(await pickShared(v, ['a', 'b', 'c'], (k, ms, f) => f()), 'a'); assert.equal(seen.length, 2);
});
