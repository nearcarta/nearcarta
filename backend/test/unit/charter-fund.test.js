import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { charterFundMarkup, charterTopUpYocto, nearStringFromYocto } from '../../../shared/setup/charter-fund.js';

const Y = 10n ** 24n;

test('the charter top-up default reaches max(cap + 0.01, 0.01), in steps of 0.005', () => {
  const cap = Y * 6n / 100n; // 0.06 — a ferry wrap of ~0.05 plus storage needs the row near 0.07
  const row = Y / 100n; // 0.01, the balance open_charter keeps
  const account = Y; // 1 NEAR
  // target 0.07, gap 0.06, already on a 0.005 step
  assert.equal(charterTopUpYocto({ capYocto: cap, rowYocto: row, accountYocto: account }), Y * 6n / 100n);
  assert.equal(nearStringFromYocto(Y * 6n / 100n), '0.06');
  // 0.07 - 0.012 = 0.058, which rounds up to 0.060
  assert.equal(charterTopUpYocto({ capYocto: cap, rowYocto: Y * 12n / 1000n, accountYocto: account }), Y * 6n / 100n);
  // a 0.0001 gap still rounds up to the 0.005 step, and the 0.001 floor applies only below that
  assert.equal(charterTopUpYocto({ capYocto: cap, rowYocto: Y * 699n / 10000n, accountYocto: account }), Y / 200n);
  assert.equal(charterTopUpYocto({ capYocto: cap, rowYocto: cap + Y / 100n, accountYocto: account }), Y / 1000n);
  // an exact 0.005 gap stays 0.005
  assert.equal(charterTopUpYocto({ capYocto: cap, rowYocto: Y * 65n / 1000n, accountYocto: account }), Y / 200n);
  // never more than the account minus a 0.01 gas reserve: 0.05 - 0.01 = 0.04
  assert.equal(charterTopUpYocto({ capYocto: cap, rowYocto: row, accountYocto: Y * 5n / 100n }), Y * 4n / 100n);
  // room of exactly 0.001 stays 0.001; a smaller room is not rounded back up to the minimum
  assert.equal(charterTopUpYocto({ capYocto: cap, rowYocto: row, accountYocto: Y / 100n + Y / 1000n }), Y / 1000n);
  assert.equal(charterTopUpYocto({ capYocto: cap, rowYocto: row, accountYocto: Y / 100n + Y / 2000n }), Y / 2000n);
  // cap 0 still aims at 0.01; a small cap of 0.005 with 0.01 already on the row adds 0.005
  assert.equal(charterTopUpYocto({ capYocto: 0n, rowYocto: 0n, accountYocto: account }), Y / 100n);
  assert.equal(charterTopUpYocto({ capYocto: Y / 200n, rowYocto: row, accountYocto: account }), Y / 200n);
  // an unknown account balance is not clamped
  assert.equal(charterTopUpYocto({ capYocto: cap, rowYocto: row, accountYocto: null }), Y * 6n / 100n);
});

test('add NEAR stays on the try step when the row balance is not low', () => {
  const html = charterFundMarkup({ amountNear: '0.06', lowBalance: false, rowNear: '0.05' });
  assert.match(html, /data-testid="try-topup"/);
  assert.match(html, /Add NEAR to the charter/);
  assert.match(html, /data-testid="try-fund-amt"/);
  assert.match(html, /value="0\.06"/);
  assert.match(html, /This amount goes to your charter's row balance\. It comes back to you on close_charter \(teardown\)\./);
  assert.doesNotMatch(html, /try-lowbal/);
  assert.doesNotMatch(html, /disabled/);
  const low = charterFundMarkup({ amountNear: '0.06', lowBalance: true, rowNear: '0', hintNear: '0.005' });
  assert.match(low, /data-testid="try-lowbal"/);
  assert.match(low, /holds 0 NEAR/);
  assert.match(low, /Add 0\.005 NEAR to it with one approval/);
  assert.match(low, /data-testid="try-topup"/);
  const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
  assert.match(src, /charterFundMarkup\(/);
  assert.match(src, /methodName: 'fund'/);
  assert.match(src, /deposit: deposit\.toString\(\)/);
  assert.doesNotMatch(src, /deposit: TOPUP/);
  assert.doesNotMatch(src, /lowBal\(\) \|\| topUpBusy \?/);
});
