import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PAST } from '../../../shared/arena/prompts.js';

const PATTERNS = ['fake-invoice payee swap', 'prompt-injected recipient', 'urgency or authority impersonation',
  'allowlist look-alike account', 'split payments under the cap', 'repeat drain over time'];

test('arena corpus names each scam pattern and a decision tx', () => {
  for (const p of PATTERNS) {
    const rows = PAST.filter(s => s.pattern === p);
    assert.ok(rows.length >= 1, p);
    assert.ok(rows.every(s => typeof s.decision_tx === 'string' && s.decision_tx.length >= 32), p);
  }
});

test('arena corpus prompts hash and stay on .near payees', () => {
  for (const s of PAST) {
    if (!s.prompt) continue;
    assert.equal(crypto.createHash('sha256').update(s.prompt).digest('hex').length, 64);
  }
  const blob = JSON.stringify(PAST);
  assert.equal(blob.includes('.near'), true);
});
