import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const skipDir = new Set(['node_modules', 'target', 'dist', '.git', 'artifacts']);
const textExt = /\.(md|js|mjs|jsx|html|txt|py|json|css|yml|yaml|toml|rs)$/;
const banned = new RegExp(['social' + ' money', 'sp' + 'utnik', 'tr' + 'ezu'].join('|'), 'i');

function walk(dir, hits) {
  for (const name of readdirSync(dir)) {
    if (skipDir.has(name)) continue;
    const p = join(dir, name);
    const rel = relative(root, p);
    if (rel === 'docs/internal' || rel.startsWith('docs/internal/')) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, hits);
    else if (textExt.test(name)) {
      const text = readFileSync(p, 'utf8');
      if (banned.test(text)) hits.push(rel);
    }
  }
}

test('public files do not name a retired track', () => {
  const hits = [];
  walk(root, hits);
  assert.deepEqual(hits, []);
});

test('the eight tracks are the eight buildings', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const tracks = ['DeFi', 'Privacy', 'Autonomous Business', 'AI Security', 'Agent Economy', 'Real-World Money', 'Games', 'Open'];
  for (const t of tracks) assert.match(readme, new RegExp(`\\| ${t} \\|`));
  assert.doesNotMatch(readme, /\| Social \|/);
  assert.doesNotMatch(readme, /\| NFTs \|/);
  const names = readFileSync(join(root, 'app/design/D8_shops/js/names.js'), 'utf8');
  const town = readFileSync(join(root, 'app/design/D9_world/js/core.js'), 'utf8');
  const map = {
    ferry: 'DeFi', bank: 'Privacy', chronicle: 'Autonomous Business', toll: 'Autonomous Business',
    guard: 'AI Security', hall: 'Agent Economy', payouts: 'Real-World Money', arena: 'Games', house: 'Open',
  };
  for (const [id, track] of Object.entries(map)) {
    assert.match(names, new RegExp(`${id}: '${track.replace('-', '\\-')}'`));
    assert.match(town, new RegExp(`track:'${track.replace('-', '\\-')}'`));
  }
});
