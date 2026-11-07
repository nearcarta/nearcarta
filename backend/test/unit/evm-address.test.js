import test from 'node:test';
import assert from 'node:assert/strict';
import { missingCross, normaliseEvm } from '../../../app/src/foreign-path.js';

test('a checksummed Base address is accepted, not just lowercase', () => {
  // Real values a visitor copies. EIP-55 is mixed case and the old check demanded lowercase,
  // so 0x0000...dEaD and a normal checksummed address were both refused.
  for (const to of [
    '0x000000000000000000000000000000000000dEaD',
    '0xBDfC3e0dC6e9f6a0e4d1b1C9b8a7F6e5d4C3b2A1',
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  ]) assert.equal(missingCross({ to, asset: 'native', amount: '0.00001' }), '', to);
});

test('bad addresses and amounts are still refused', () => {
  assert.match(missingCross({ to: '0x123', asset: 'native', amount: '1' }), /Base address/);
  assert.match(missingCross({ to: 'nearcarta.near', asset: 'native', amount: '1' }), /Base address/);
  assert.match(missingCross({ to: '0x000000000000000000000000000000000000dEaD', asset: 'native', amount: '0' }), /amount/);
  assert.match(missingCross({ to: '0x000000000000000000000000000000000000dEaD', asset: 'doge', amount: '1' }), /asset/);
});

test('the normalised form is what goes on chain', () => {
  assert.equal(normaliseEvm('0xBDfC3e0dC6e9f6a0e4d1b1C9b8a7F6e5d4C3b2A1'), '0xbdfc3e0dc6e9f6a0e4d1b1c9b8a7f6e5d4c3b2a1');
});
