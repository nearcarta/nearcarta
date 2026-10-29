import test from 'node:test';
import assert from 'node:assert/strict';
import * as tg from '../../src/tollgate.js';
import { DEP } from '../../src/config.js';

test('toll gate is in the deployments file with 0 keys and the v4 artifact hash', () => {
  assert.equal(DEP.toll_gate.access_keys, 0);
  assert.equal(DEP.toll_gate.wasm_sha256, '950253ae8fe4b4395823e4ac477dfe412353d3be33443a26ce894d75eb171197');
  assert.equal(DEP.toll_gate.policy.memo, 'toll:base-sepolia');
});
test('a bad nonce is refused before any read', async () => {
  for (const n of ['x', '-1', '1.5']) {
    await assert.rejects(tg.visit(n), e => e.status === 400);
    await assert.rejects(tg.broadcast(n), e => e.status === 400);
  }
});
