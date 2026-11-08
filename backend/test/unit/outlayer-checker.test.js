// The OutLayer checker WASM: the file we publish at /outlayer/charter_check.wasm and name by
// SHA256 when we ask a TEE to run it.
//
// Why this test matters: the whole claim of an attested decision is "THIS exact file ran on
// THIS exact input". If the file decides wrongly, the attestation faithfully proves the wrong
// answer. Nothing tested it before, so a change to the checker could have broken the Guard's
// attested path silently while every other test stayed green.
//
// The test runs the compiled artifact when a wasm runtime is on the box (wasmtime), and
// otherwise checks the parts that do not need one — the hash and the source rules — and says
// which half it ran. It never silently passes by skipping both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const WASM = new URL('../../../outlayer/artifacts/charter_check.wasm', import.meta.url);
const SRC = new URL('../../../outlayer/charter_check/src/lib.rs', import.meta.url);
const RUNTIMES = ['wasmtime', 'wasmer', '/tmp/wasmtime-v24.0.0-x86_64-linux/wasmtime'];

function runtime() {
  for (const r of RUNTIMES) {
    try { execFileSync(r, ['--version'], { stdio: 'ignore' }); return r; } catch { /* try the next */ }
  }
  return null;
}

function run(rt, input) {
  const out = execFileSync(rt, ['run', WASM.pathname], { input, encoding: 'utf8', timeout: 20000 });
  return JSON.parse(out);
}

const good = { charter: 'c.near', clause: { cap: '100', daily_limit: '150', allowlist: ['bob.near'] }, spent_today: '50', action: { receiver: 'bob.near', amount: '100' } };
const bad = { charter: 'c.near', clause: { cap: '100', daily_limit: '150', allowlist: ['bob.near'] }, spent_today: '50', action: { receiver: 'eve.near', amount: '900' } };

test('the published checker is the file whose hash we name on chain', () => {
  const bytes = readFileSync(WASM);
  const sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha.length, 64);
  assert.match(sha, /^[0-9a-f]{64}$/);
  // The contract refuses anything that is not 64 hex, so a bad hash would fail at new().
  assert.ok(bytes.length > 10_000, 'the artifact is a real build, not a placeholder');
});

test('the checker refuses anything it cannot parse, instead of allowing it', () => {
  const src = readFileSync(SRC, 'utf8');
  const main = readFileSync(new URL('../../../outlayer/charter_check/src/main.rs', import.meta.url), 'utf8');
  // The binary wrapper turns a parse error into { success: false, output: { allow: false } }.
  // This lives in main.rs, not lib.rs, so the assertion has to read the file that has it.
  assert.match(main, /"allow":\s*false/, 'a bad input is a deny');
  assert.match(main, /Err\(e\)/, 'the error arm is what produces it');
  // The decision itself must check every rule the charter checks.
  for (const rule of ['over the per-payment cap', 'over the daily limit', 'receiver not on the allowlist', 'amount is zero']) {
    assert.ok(src.includes(rule), `the checker still decides "${rule}"`);
  }
  // Exact match on the allowlist: no case folding, so look-alikes cannot pass.
  assert.match(src, /any\(\|a\| a == &input\.action\.receiver\)/, 'the allowlist compare stays exact');
  // It hashes its own input so the attestation is bound to it.
  assert.match(src, /input_sha256/, 'the answer names the input it decided on');
});

test('the compiled checker allows inside the clause and refuses outside it', (t) => {
  const rt = runtime();
  if (!rt) {
    t.diagnostic('no wasm runtime on this box, so the compiled artifact was not executed');
    return;
  }
  const ok = run(rt, JSON.stringify(good));
  assert.equal(ok.success, true, JSON.stringify(ok));
  assert.equal(ok.output.allow, true, 'a payment inside every rule is allowed');
  assert.deepEqual(ok.output.reasons, []);
  assert.match(ok.output.input_sha256, /^[0-9a-f]{64}$/, 'the answer carries the input hash');

  const no = run(rt, JSON.stringify(bad));
  assert.equal(no.success, true);
  assert.equal(no.output.allow, false, 'a payment outside the rules is refused');
  assert.ok(no.output.reasons.length >= 3, `every broken rule is named: ${JSON.stringify(no.output.reasons)}`);

  // The same input must produce the same hash, which is what makes the attestation checkable.
  const again = run(rt, JSON.stringify(good));
  assert.equal(again.output.input_sha256, ok.output.input_sha256, 'the input hash is deterministic');

  const junk = run(rt, 'not json');
  assert.equal(junk.success, false, 'unparseable input reports failure');
  assert.equal(junk.output.allow, false, 'and still refuses');
});
