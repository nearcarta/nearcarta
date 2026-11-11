// The judge's one click. It must be honest about what it did: a real throwaway testnet account, one row
// per real transaction with its explorer link, and a refusal that says so instead of pretending.
// Docs: https://docs.near.org/protocol/transactions/meta-tx · https://api-testnet.nearblocks.io/api-docs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url).pathname;
const read = (p) => readFileSync(root + p, 'utf8');

test('the judges page has one button that runs the whole loop', () => {
  const html = read('app/src/judges.html');
  const run = read('app/src/judges-run.js');
  // The host is on the page and the runner is installed next to the existing judge content.
  assert.match(html, /id="judge-runner"/);
  assert.match(html, /installJudgeRunner/);
  assert.match(run, /data-testid="run-loop"/);
  // It is testnet only, and says why when it is not.
  assert.match(run, /canRun/);
  assert.match(run, /ERR_NOT_TESTNET/);
  assert.match(run, /net=testnet/);
});

test('the loop is the real guest path, not a mock', () => {
  const run = read('app/src/judges-run.js');
  // A real account through the real service.
  assert.match(run, /startGuest\(/);
  assert.match(run, /welcomeCrate\(/);
  assert.match(run, /guestSigner\(/);
  // The same board row and the same step functions a guest walks.
  assert.match(run, /openRow/);
  assert.match(run, /live\.step\(id/);
  assert.match(run, /live\.step\('seal'\)/);
  assert.match(run, /live\.step\('cross'\)/);
  // Nothing is invented: a step with no hash is a failure, not a pass.
  assert.match(run, /state: r\?\.hash \? 'ok' : 'failed'/);
});

test('every step row links its hash on the testnet explorer', () => {
  const run = read('app/src/judges-run.js');
  assert.match(run, /txUrl\(/);
  assert.match(run, /target="_blank" rel="noopener">open ↗/);
  // The toll row says, in the row itself, that it was signed and not broadcast.
  assert.match(run, /not sent to Base Sepolia/);
  assert.match(run, /signed transaction is shown and not broadcast/);
  // The bank row says the amount is not on chain.
  assert.match(run, /the amount is not on chain/);
});
