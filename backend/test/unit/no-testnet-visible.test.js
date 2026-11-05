import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { retiredNet } from '../../../shared/net/word-scan.js';

const root = new URL('../../../', import.meta.url).pathname;
const bad = new RegExp(`${retiredNet.source}|r2own|ncguest|utest1`, 'i');

function walk(dir, hits) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path, hits); continue; }
    if (!/\.(js|html|css|json|txt|mjs|svg)$/.test(name)) continue;
    if (bad.test(readFileSync(path, 'utf8'))) hits.push(path.slice(root.length));
  }
}

test('the built site does not name the rehearsal network', () => {
  execFileSync(process.execPath, ['app/build.mjs'], { cwd: root, stdio: 'pipe', env: { ...process.env, NEARCARTA_API: '' } });
  const hits = [];
  walk(join(root, 'app/dist'), hits);
  assert.deepEqual(hits, []);
});
