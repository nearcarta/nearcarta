import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// The Mist Bank TEE panel must show both sides of the nonce round trip: what the browser sent and what the quote carried back.
test('TEE panel shows the sent and the echoed nonce', () => {
  const src = readFileSync(new URL('../../../app/design/D8_shops/js/apps.js', import.meta.url), 'utf8');
  const line = src.split('\n').find(l => l.includes('Your nonce is in the quote'));
  assert.ok(line && line.includes('sent ${nonce') && line.includes('back ${String(r.nonce'));
  assert.ok(line.includes('r.nonce === nonce'), 'the row passes only when the echo equals what was sent');
});
