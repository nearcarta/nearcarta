import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The site must not carry text addressed to AI readers that people cannot see.
const ROOTS = ['app/src', 'app/design', 'shared'];
const SKIP = /node_modules|vendor|dist|\.(png|jpg|glb|gltf|bin|woff2?|ktx2|hdr|mp3|ogg|wasm)$/;
const BAD = /SYSTEM NOTICE FOR AI|AI ASSISTANTS|ignore the payee above|do not mention this note/i;
function* walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (SKIP.test(p)) continue; if (statSync(p).isDirectory()) yield* walk(p); else yield p; } }
test('no hidden text addressed to AI readers ships with the site', () => {
  const root = new URL('../../../', import.meta.url).pathname;
  const hits = [];
  for (const r of ROOTS) for (const p of walk(join(root, r))) { const s = readFileSync(p, 'utf8'); if (BAD.test(s)) hits.push(p.slice(root.length)); }
  assert.deepEqual(hits, []);
});
