import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusHelp, STATUS_HELP, tidepoolStatus } from '../../src/ferry.js';

test('every 1Click status has a plain explanation, including INCOMPLETE_DEPOSIT', () => {
  for (const s of ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED']) assert.ok(STATUS_HELP[s]);
  assert.match(statusHelp('INCOMPLETE_DEPOSIT'), /Less than the quoted amount/);
  assert.match(statusHelp('NEW_THING'), /Unknown status/);
});

test('tidepoolStatus passes INCOMPLETE_DEPOSIT through as not final, with help', async () => {
  const f = async () => ({ status: 200, ok: true, json: async () => ({ status: 'INCOMPLETE_DEPOSIT', updatedAt: 't', swapDetails: { depositedAmountFormatted: '0.5' } }) });
  const r = await tidepoolStatus('a'.repeat(64), f, async () => ({ ok: true }));
  assert.equal(r.status, 'INCOMPLETE_DEPOSIT');
  assert.equal(r.final, false);
  assert.match(r.help, /send the rest/i);
});
