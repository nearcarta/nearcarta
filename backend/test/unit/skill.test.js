import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const skill = readFileSync(new URL('skills/nearcarta/SKILL.md', root), 'utf8');
const app = readFileSync(new URL('backend/src/app.js', root), 'utf8');
const routes = [...app.matchAll(/app\.(get|post)\('([^']+)'/g)].map(m => ({ method: m[1], path: m[2] }));
const toRe = p => new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '$');
const used = [...skill.matchAll(/\$BASE(\/api\/[^\s"`?]*)/g)].map(m => m[1].replace(/<[^>]+>/g, 'x'));

test('skill has name and description front matter', () => {
  assert.match(skill, /^---\nname: nearcarta\ndescription: .{40,}\n---/);
});
test('every skill call maps to a GET route in the API', () => {
  assert.ok(used.length >= 8);
  for (const u of used) {
    const hit = routes.find(r => toRe(r.path).test(u));
    assert.ok(hit, 'no route for ' + u);
    assert.equal(hit.method, 'get', u + ' must be read-only');
  }
});
test('skill names no write route', () => {
  for (const r of routes.filter(r => r.method === 'post')) assert.ok(!skill.includes(r.path), r.path);
});
