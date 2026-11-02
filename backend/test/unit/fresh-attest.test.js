import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../../src/agent.js';
test('every question gets its own attestation (no cache between asks)', async () => {
  let n = 0; const run = async () => ({ ok: true, nonce: String(++n) });
  const a = await preflight({ run }), b = await preflight({ run });
  assert.equal(n, 2); assert.notEqual(a.nonce, b.nonce);
});
