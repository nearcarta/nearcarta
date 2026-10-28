import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prove } from '../../src/ai.js';

test('a failed TEE preflight means no completion request is ever sent (nothing billable)', async () => {
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not be called'); };
  try {
    const r = await prove('x', { preflight: async () => ({ ok: false, gateway: { ok: false }, models: [] }) });
    assert.equal(r.verified, false);
    assert.match(r.why, /completion not sent/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = realFetch; }
});
