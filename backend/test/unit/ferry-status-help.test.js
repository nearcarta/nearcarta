import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusHelp, STATUS_HELP } from '../../src/ferry.js';

test('every 1Click status has a plain explanation, including INCOMPLETE_DEPOSIT', () => {
  for (const s of ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED']) assert.ok(STATUS_HELP[s]);
  assert.match(statusHelp('INCOMPLETE_DEPOSIT'), /Less than the quoted amount/);
  assert.match(statusHelp('NEW_THING'), /Unknown status/);
});

test('INCOMPLETE_DEPOSIT is explained in plain words', () => {
  assert.match(statusHelp('INCOMPLETE_DEPOSIT'), /send the rest/i);
});
