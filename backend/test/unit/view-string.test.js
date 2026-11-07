import test from 'node:test';
import assert from 'node:assert/strict';
import { viewFn } from '../../../shared/vault/tx.js';
const enc = s => [...new TextEncoder().encode(s)];
test('a plain-string view is returned as text, not parsed as JSON', async () => {
  const text = 'board-call-as-v1|mainnet|board.nearcarta.near|2|alice.near|guard.nearcarta.near|pay|abc|1|2|3|0|-|hold';
  const rpc = async () => ({ result: enc(text) });
  const out = await viewFn(rpc, 'board.nearcarta.near', 'call_as_message', {});
  assert.equal(out, text, 'call_as_message and confirm_message return the exact text the key signs');
});
test('a JSON view is still parsed', async () => {
  const rpc = async () => ({ result: enc('{"rows":1,"owner":"nearcarta.near"}') });
  const out = await viewFn(rpc, 'board.nearcarta.near', 'get_config', {});
  assert.deepEqual(out, { rows: 1, owner: 'nearcarta.near' });
});
test('an empty view is null, not an empty-string parse error', async () => {
  const rpc = async () => ({ result: [] });
  assert.equal(await viewFn(rpc, 'board.nearcarta.near', 'get_charter', {}), null);
});
