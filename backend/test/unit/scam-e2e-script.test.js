// The scam errand's command-line proof has to fail when a receipt is missing, or it is not proof.
// This reads the script and asserts its exit contract, then runs it against a stub service that is off,
// which must exit 2 rather than print a pass.
// Docs: https://docs.near.org/protocol/transactions · https://docs.near.org/api/rpc/transactions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('../../../', import.meta.url).pathname;
const src = readFileSync(root + 'scripts/scam-e2e.mjs', 'utf8');

test('the script refuses a mainnet service before it can spend anything', () => {
  assert.match(src, /network\?\.name !== 'testnet'/);
  assert.match(src, /die\([^)]*testnet service[^)]*2\)/);
});

test('it requires a digest, an anchor tx and a forced tx, and refuses a missing one', () => {
  assert.match(src, /asked\.body\.digest\.length !== 64/);
  assert.match(src, /die\('missing: the anchor of the signed refusal'\)/);
  assert.match(src, /die\('missing: the forced over-limit transaction'\)/);
  // A charter that ALLOWS the over-limit payment is a failure, not a pass.
  assert.match(src, /if \(!forced\.failure\) die\('the charter ALLOWED an over-limit payment/);
});

test('it prints both hashes and their testnet links', () => {
  assert.match(src, /anchor tx: \$\{anchored\.hash\}/);
  assert.match(src, /forced tx: \$\{forced\.hash\}/);
  assert.match(src, /https:\/\/testnet\.nearblocks\.io\/txns\/\$\{anchored\.hash\}/);
  assert.match(src, /https:\/\/testnet\.nearblocks\.io\/txns\/\$\{forced\.hash\}/);
});

test('the script exits nonzero when the service is not the guest one', () => {
  const r = spawnSync(process.execPath, ['scripts/scam-e2e.mjs', '--base', 'http://127.0.0.1:9'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(r.status, 0, 'a service that does not answer is a failure, not a pass');
  assert.match(String(r.stderr || ''), /FAILED|not the testnet service|did not answer/);
  assert.doesNotMatch(String(r.stdout || ''), /PASS:/);
});
