#!/usr/bin/env node
// Targeted mutation test for backend JS: each mutant edits one line of a source file, runs one unit test file,
// and must make it fail ("killed"). Usage: node scripts/verify/js_mutants.mjs <mutants.json>
// mutants.json: { "file": "backend/src/x.js", "test": "backend/test/unit/x.test.js", "mutants": [[from, to], ...] }
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const file = resolve(root, spec.file), orig = readFileSync(file, 'utf8');
let missed = 0;
try {
  for (const [from, to] of spec.mutants) {
    if (orig.split(from).length !== 2) { console.log('BAD  (not exactly one match)', from); missed++; continue; }
    writeFileSync(file, orig.replace(from, to));
    const r = spawnSync(process.execPath, ['--test', resolve(root, spec.test)], { cwd: resolve(root, 'backend'), env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 120_000 });
    const killed = r.status !== 0;
    if (!killed) missed++;
    console.log(killed ? 'KILLED' : 'MISSED', JSON.stringify(from), '->', JSON.stringify(to));
  }
} finally { writeFileSync(file, orig); }
console.log(`${spec.mutants.length - missed}/${spec.mutants.length} killed`);
process.exit(missed ? 1 : 0);
