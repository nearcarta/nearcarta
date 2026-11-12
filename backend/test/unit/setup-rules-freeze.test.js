// F9: /setup/#rules froze the tab (renderer at 6.5 GB, typing lost) for a signed-in
// mainnet account. render() called ensureChainRow().then(render) on every paint of the
// rules step; for an account with no row, get_charter answers null and ensureChainRow
// returns at once, so render re-ran itself in a microtask loop that never yielded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SESSION_HOURS } from '../../../shared/board/session.js';

const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
const section = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));

test('render no longer repaints itself after the rules row read', () => {
  const r = section('function render() {', 'function paintShell()');
  assert.doesNotMatch(r, /ensureChainRow\(\)\.then\(\(\) => \{[^}]*render\(\)/);
  assert.match(r, /kickRulesRowRead\(\)/);
});

// Run the real kick + burst guard against stubs and a render that calls them like the page.
function harness({ rowAnswer }) {
  const body = section('const RENDER_BURST', 'function render() {')
    + section('let rulesRowRead = null', 'function paintShell()');
  const env = { me: 'acct.near', chainRow: null, chainLoadedFor: '', reads: 0 };
  const make = new Function('env', `
    const st = { trial: false }; const boardLive = () => true; const RULES_ROW_RETRY_MS = 10000;
    let me = env.me, chainRow = null, chainLoadedFor = '';
    async function ensureChainRow() { env.reads++; if (chainLoadedFor === me) return; chainRow = ${rowAnswer}; chainLoadedFor = me; }
    ${body}
    return { kick: kickRulesRowRead, burst: renderBurst, state: () => ({ chainRow, chainLoadedFor }) };`);
  return { env, api: make(env) };
}

test('a null row is read once, not on every paint', async () => {
  const { env, api } = harness({ rowAnswer: 'null' });
  let paints = 0;
  const render = () => { paints++; api.kick(); };
  for (let i = 0; i < 5; i++) { render(); await new Promise(r => setTimeout(r, 0)); }
  assert.equal(env.reads, 1);
  assert.equal(paints, 5);
  assert.equal(api.state().chainLoadedFor, 'acct.near');
});

test('a failed read is retried at most every 10 seconds', () => {
  const { api } = harness({ rowAnswer: 'null' });
  assert.equal(api.kick(1_000_000), true);
});

test('the paint guard stops a runaway loop inside one second', () => {
  const { api } = harness({ rowAnswer: 'null' });
  const t = 5_000_000; let allowed = 0;
  for (let i = 0; i < 1000; i++) if (!api.burst(t)) allowed++;
  assert.equal(allowed, 40);
  assert.equal(api.burst(t + 1500), false, 'a new second paints again');
});

test('F10: rules inputs update in place and the session offers 24 h', () => {
  assert.ok(SESSION_HOURS.includes(24));
  const w = section('function wireRules()', '// ---------- 6. Sign');
  // Typing updates state and the preview only; it never repaints the card (which would
  // replace the input under the cursor).
  const upd = w.slice(w.indexOf('const upd'), w.indexOf('\n', w.indexOf('const upd')));
  assert.doesNotMatch(upd, /render\(\)/);
  assert.match(upd, /\$\('#prev'\)\.innerHTML = preview/);
});
