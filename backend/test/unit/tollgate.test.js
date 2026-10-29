import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as tg from '../../src/tollgate.js';
import { DEP } from '../../src/config.js';

test('toll gate is in the deployments file with 0 keys and the v5 artifact hash', () => {
  assert.equal(DEP.toll_gate.access_keys, 0);
  assert.equal(DEP.toll_gate.wasm_sha256, createHash('sha256').update(readFileSync(new URL('../../../' + DEP.toll_gate.wasm, import.meta.url))).digest('hex'));
  assert.equal(DEP.toll_gate.wasm_sha256, 'ae57ff8dfcc47e0553c0b83a665438a5b81da2ec0d080ca9e430e76b81901e28');
  assert.equal(DEP.toll_gate.policy.memo, 'toll:base-sepolia');
});
test('the toll gate accepts the current factory and every older one', () => {
  const v = DEP.vault, list = DEP.toll_gate.policy.factories;
  for (const f of [v.factory, ...(v.legacy || []).map(l => l.factory || l)]) assert.ok(list.includes(f), f);
});
test('a bad nonce is refused before any read', async () => {
  for (const n of ['x', '-1', '1.5']) {
    await assert.rejects(tg.visit(n), e => e.status === 400);
    await assert.rejects(tg.broadcast(n), e => e.status === 400);
  }
});
