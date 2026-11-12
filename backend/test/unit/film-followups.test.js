// Film follow-ups from the 2026-11-12 mainnet take: F29-F34.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('F29: the Payouts anchor result is a full nearblocks link, not a cut hash', () => {
  const src = read('app/src/panels/payouts-tray.js');
  assert.match(src, /data-testid="payout-anchor-tx"/);
  assert.doesNotMatch(src, /Anchored\. tx \$\{esc\(String\(state\.anchored\)\.slice/);
});

test('F30: a successful invoice anchor lands in the Payouts drawer history', () => {
  const src = read('app/design/D8_shops/js/shopui.js');
  assert.match(src, /rememberReceipt\(out\.tx, 'payouts', 'allowed', 'anchor'/);
});

test('F31: the created invoice spans the whole invoice pane', () => {
  const css = read('app/src/panels/shop-shell.css');
  assert.match(css, /\.ferry-pane\[data-pane='invoice'\] > \.payout-result/);
});

test('F32: a failed rules read is not kept for the visit', () => {
  const src = read('app/src/panels/chronicle-view.js');
  assert.match(src, /!state\.rules\.refresh && state\.rules\.version\) return state\.rules/);
});

test('F33: the attestation button shows the file and offers a download', () => {
  const src = read('app/src/panels/bank-tray.js');
  assert.match(src, /state\.fileJson = JSON\.stringify\(j, null, 2\)/);
  assert.match(src, /data-testid="bank-attest-download"/);
});

test('F34: the ferryman no longer repeats an old recorded swap to every visitor', () => {
  const src = read('app/design/D9_world/js/life.js');
  assert.doesNotMatch(src, /SP\.say\(fm,'0\.045 wNEAR became/);
  assert.match(src, /__ncSessionSwap/);
});

test('F35: nothing in the Mist Bank column shrinks under its content; the column scrolls', () => {
  const css = read('app/src/panels/bank.css');
  assert.match(css, /body\.bank-tray #shopUI #tray > \.t-scroll > \* \{ flex-shrink: 0 !important; \}/);
  assert.match(css, /body\.bank-tray #shopUI #tray > \.t-scroll \{ overflow-y: auto/);
});
