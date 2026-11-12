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

test('the one click and the scam errand load the guest story module from where the build puts it', async () => {
  const { existsSync } = await import('node:fs');
  const { posix } = await import('node:path');
  for (const file of ['app/src/judges-run.js', 'app/src/net/scam.js']) {
    const specs = [...read(file).matchAll(/import\('(\.[^']+)'\)/g)].map((m) => m[1]);
    assert.ok(specs.length, `${file} imports the guest story`);
    for (const s of specs) {
      // The page serves app/src at the site root, so resolve as the browser would.
      const target = posix.join(posix.dirname(file), s);
      assert.ok(existsSync(root + target), `${file} imports ${s}, which is missing (${target})`);
    }
  }
});

test('a mainnet page never shows a dead button: Try free, the loop and the errand each lead to testnet', () => {
  const run = read('app/src/judges-run.js');
  const chrome = read('app/src/net/chrome.js');
  // The loop: on mainnet the button is a link to the same page on testnet with run=1, which starts it.
  assert.match(run, /data-testid="run-loop-switch" href="\$\{esc\(runUrl\(\)\)\}"/);
  assert.match(run, /searchParams\.set\('run', '1'\)/);
  assert.match(run, /searchParams\.get\('run'\) === '1'/);
  // Try free from a mainnet page moves to testnet with try=1 and starts there, instead of practice mode.
  assert.match(chrome, /if \(NET !== 'testnet'\) \{ globalThis\.location\?\.assign\(tryFreeUrl\(\)\)/);
  assert.match(chrome, /searchParams\.set\('try', '1'\)/);
  assert.match(chrome, /wantsTryFree\(\)\) \{ dropTryParam\(\); startTryFree/);
  // Play for real is pinned to mainnet.
  assert.match(chrome, /data-testid="sign-in" href="\/setup\/\?net=mainnet"/);
  // The errand on mainnet links to itself on testnet.
  assert.match(read('app/src/net/scam.js'), /data-testid="scam-switch" href=/);
});

test('a guest invest tops the purse up to one share first, and says so when the Arena pays too little', () => {
  const g = read('app/src/market/live-guest.js');
  const inv = g.slice(g.indexOf("if (id === 'invest')"), g.indexOf("if (id === 'invest')") + 900);
  // One share is one milliNEAR from the purse; the top-up runs before the invest move.
  assert.ok(inv.indexOf('topUpPurse()') > 0 && inv.indexOf('topUpPurse()') < inv.indexOf("action: 'invest'"));
  assert.match(inv, /ERR_PURSE_SHORT/);
  // Bounded: at most two rounds (it sells the best-paying good), each gather spaced past the node's 30 s gap.
  assert.match(g, /async function topUpPurse\(\{ rounds = 2 \}/);
  assert.match(g, /GATHER_GAP_MS = 31_000/);
  // The sell line shows the real quote before and after, not the practice price.
  assert.match(g, /before: BigInt\(q\.sell\), after: BigInt\(q2\.sell\)/);
});
