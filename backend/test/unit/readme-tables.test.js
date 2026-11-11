// The README's tables are the contract with a judge: every row names the file that does the work and a
// test that pins it, and one table says plainly what is on chain, what the operator runs and what the
// game simulates. A claim with no test behind it must not appear.
//
// This walks the README, extracts every test name it cites, and checks each one exists in the suite.
// Docs: none (a documentation invariant); the tests it names are the evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const readme = readFileSync(join(root, 'README.md'), 'utf8');

/** Every `test('…')` / `test("…")` name in the backend suite, so a citation can be resolved. */
function testNames() {
  const names = new Set();
  const dir = join(root, 'backend/test/unit');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.test.js')) continue;
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/\btest\(\s*'([^']+)'/g)) names.add(m[1]);
    for (const m of src.matchAll(/\btest\(\s*"([^"]+)"/g)) names.add(m[1]);
  }
  return names;
}

test('every test the README names exists in the suite', () => {
  const names = testNames();
  // Backticked strings that look like a test name: a colon or a sentence, not a file or an account.
  const cited = new Set();
  for (const m of readme.matchAll(/`([a-z][^`]{18,160})`/g)) {
    const s = m[1];
    if (/\.(js|json|md|wasm|mjs)$/.test(s) || s.includes('/') || s.includes('http')) continue;
    if (/^npm (run|test)\b/.test(s)) continue; // a command, not a test name
    if (!/[:]/.test(s)) continue;
    cited.add(s);
  }
  const missing = [...cited].filter((s) => !names.has(s) && ![...names].some((n) => n.startsWith(s.replace(/…$/, ''))));
  assert.deepEqual(missing, [], `the README cites tests that do not exist:\n${missing.join('\n')}`);
});

test('the README has the try-free table, the on-chain table and the front-door section', () => {
  for (const h of ['### Try free: a guest account on the test network',
    '### What is on chain, what the operator runs, what is simulated',
    '### The game is the front door']) {
    assert.ok(readme.includes(h), `README has "${h}"`);
  }
  // The on-chain table names all three categories in words a judge can act on.
  const at = readme.indexOf('### What is on chain, what the operator runs, what is simulated');
  const table = readme.slice(at, at + 2000);
  for (const w of ['On chain', 'Operator', 'Simulated', 'Quoted, not executed', 'Signed, not broadcast']) {
    assert.ok(table.includes(w), `the on-chain table says "${w}"`);
  }
  // The try-free table covers every one of the nine story steps.
  const tb = readme.indexOf('### Try free: a guest account on the test network');
  const body = readme.slice(tb, at);
  for (const step of ['Take order', 'Unload salt', 'Cross', 'Check buyers', 'Sell', 'Seal profit', 'Pay porter', 'Invest', 'Write the day']) {
    assert.ok(body.includes(step), `the try-free table covers "${step}"`);
  }
});
