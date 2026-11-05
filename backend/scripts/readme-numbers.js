// Writes the counts in README.md and judges/VERIFY.md from real outputs, so no number is typed by hand.
// Sources: judges/proofs/mainnet-proof-check.json (npm run verify:mainnet), judges/proofs/e2e-results.json and
// e2e-vercel.json (Playwright JSON reporter), a run of the unit tests, and the #[test] / test( counts in the sources.
// Usage: node backend/scripts/readme-numbers.js [--check]   (--check exits 1 if a file would change)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(join(root, p), 'utf8');
const json = p => JSON.parse(read(p));
const count = (dir, re) => readdirSync(join(root, dir)).filter(f => /\.(rs|js)$/.test(f))
  .reduce((n, f) => n + (read(join(dir, f)).match(re) || []).length, 0);

const rows = json('judges/proofs/mainnet-proof-check.json').rows;
const e2e = json('judges/proofs/e2e-results.json').stats;
const vercel = json('judges/proofs/e2e-vercel.json').stats;
const unitFiles = readdirSync(join(root, 'backend/test/unit')).filter(f => f.endsWith('.test.js')).map(f => join('test/unit', f));
const tapRun = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-timeout=120000', ...unitFiles],
  { cwd: join(root, 'backend'), encoding: 'utf8', maxBuffer: 64 << 20 });
const tap = `${tapRun.stdout || ''}\n${tapRun.stderr || ''}`;
const grab = (re) => { const m = tap.match(re); if (!m) throw new Error('unit summary missing\n' + tap.slice(-800)); return +m[1]; };
const unitPass = grab(/^# pass (\d+)/m), unitFail = grab(/^# fail (\d+)/m), unitSkip = grab(/^# skipped (\d+)/m);
if (unitFail) throw new Error(`${unitFail} unit tests fail; fix them before writing numbers`);

const n = {
  unit: unitPass,
  proofsFound: rows.filter(r => r.found).length, proofs: rows.length,
  // the suite size comes from the latest full run (the live Vercel run when it is newer)
  e2e: Math.max(e2e.expected + e2e.unexpected + e2e.flaky + e2e.skipped, vercel.expected + vercel.unexpected + vercel.flaky + vercel.skipped),
  vercelPassed: vercel.expected, vercelSkipped: vercel.skipped,
  integration: count('backend/test/integration', /^\s*test\(/gm),
  oath: count('contracts/oath/src', /#\[test\]/g),
  arena: count('contracts/arena/src', /#\[test\]/g),
};

const edits = {
  'README.md': [
    [/# \d+ unit tests \(\d+ pass, \d+ skipped\):/, `# ${n.unit + unitSkip} unit tests (${n.unit} pass, ${unitSkip} skipped):`],
    [/\(\d+\/\d+ expected\)/, `(${n.proofsFound}/${n.proofs} expected)`],
    [/npm run e2e   # \d+ browser tests/, `npm run e2e   # ${n.e2e} browser tests`],
    [/`judges\/proofs\/e2e-vercel.json`: \d+ passed, \d+ skipped/, `\`judges/proofs/e2e-vercel.json\`: ${n.vercelPassed} passed, ${n.vercelSkipped} skipped`],
    [/the agent charter \(Rust, near-sdk\)\. \d+ unit tests/, `the agent charter (Rust, near-sdk). ${n.oath} unit tests`],
  ],
  'judges/VERIFY.md': [
    [/\d+\/\d+ mainnet txs found/, `${n.proofsFound}/${n.proofs} mainnet txs found`],
  ],
};

let changed = false;
for (const [file, list] of Object.entries(edits)) {
  const before = read(file);
  let after = before;
  for (const [re, to] of list) {
    if (!re.test(after)) throw new Error(`${file}: pattern not found: ${re}`);
    after = after.replace(re, to);
  }
  if (after !== before) { changed = true; if (!process.argv.includes('--check')) writeFileSync(join(root, file), after); }
  console.log(`${file}: ${after === before ? 'up to date' : (process.argv.includes('--check') ? 'OUT OF DATE' : 'updated')}`);
}
console.log(JSON.stringify(n));
if (changed && process.argv.includes('--check')) process.exit(1);
