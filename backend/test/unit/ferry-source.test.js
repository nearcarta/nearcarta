import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { b58hex, validDepositAddress } from '../../src/ferry.js';
import { otherNet, otherEvm, retiredNet } from '../../../shared/net/word-scan.js';

test('b58hex decodes a 32-byte hash', () => {
  assert.equal(b58hex('11111111111111111111111111111111'), '0'.repeat(64));
});
test('deposit address validation', () => {
  assert.ok(validDepositAddress('452122de2cfae50b6a09af025951edd3e52610f55cf165458db11d1804c4b87c'));
  assert.ok(validDepositAddress('0x2010fa71347b99f4a42dce85c0a697b7f6fdb036'));
  for (const a of ['bad addr!', '', null, 'x'.repeat(200), '../v0/faucet']) assert.equal(validDepositAddress(a), false);
});
test('ferry source does not describe a sandbox', () => {
  const s = readFileSync(new URL('../../src/ferry.js', import.meta.url), 'utf8');
  assert.equal(new RegExp(otherNet.source + '|stand-in', 'i').test(s), false);
});
