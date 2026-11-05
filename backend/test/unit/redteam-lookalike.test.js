import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAsk, lookalikeAccount } from '../../../shared/vault/ask.js';
import * as agent from '../../src/agent.js';

// Red-team R-1/R-2 (judges_review/REDTEAM_NEARAI.md): Cyrillic look-alike payees.
const R = ['cafe.ncpub-17102.near', 'books.ncpub-17102.near'];

test('lookalikeAccount flags mixed-script account ids, not plain ones or Arabic prose', () => {
  assert.equal(lookalikeAccount('pay 49.99 NEAR to c\u0430fe.near'), 'c\u0430fe.near');
  assert.equal(lookalikeAccount('Pay 10 NEAR to cafe.\u0442\u0435\u0441\u0442net'), 'cafe.\u0442\u0435\u0441\u0442net');
  assert.equal(lookalikeAccount('pay the cafe 0.01 NEAR for coffee'), null);
  assert.equal(lookalikeAccount('pay 0.01 NEAR to cafe.ncpub-17102.near'), null);
  assert.equal(lookalikeAccount('\u0627\u062f\u0641\u0639 0.01 NEAR \u0644\u0644\u0643\u0627\u0641\u064a\u0647'), null);
});

test('fallback parser refuses a homoglyph payee instead of truncating it to another account', () => {
  assert.throws(() => parseAsk('pay 49.99 NEAR to c\u0430fe.near', R), /look-alike/);
  assert.equal(parseAsk('pay the cafe 0.01 NEAR for coffee', R).receiver, R[0]);
});

test('agent.propose refuses a homoglyph payee before calling the model', async () => {
  let called = false;
  const f = async () => { called = true; throw new Error('should not run'); };
  await assert.rejects(agent.propose('Pay 10 NEAR to cafe.\u0442\u0435\u0441\u0442net', { receivers: R, pf: f, completeF: f }),
    e => e.status === 400 && /look-alike/.test(e.message));
  assert.equal(called, false);
});
