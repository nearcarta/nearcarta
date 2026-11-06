import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookalike as served } from '../../../app/src/guard-lookalike.js';
import { lookalike as shared } from '../../../shared/vault/attacks.js';

test('the served look-alike is the same function as the shared one', () => {
  // app/dist cannot resolve ../../../../shared/..., so app/src/guard-lookalike.js is served at
  // /guard-lookalike.js. It must never drift from the shared implementation the backend uses.
  const samples = ['alice.near', 'cafe.shop.near', 'bob.near', 'zzz.near', '', 'a-b.near', 'shop123.near'];
  for (const s of samples) assert.equal(served(s), shared(s), `lookalike(${JSON.stringify(s)})`);
  assert.notEqual(served('alice.near'), 'alice.near', 'a look-alike is never the input');
});
