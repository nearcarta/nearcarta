import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hallMarkup, shortId } from '../../../app/src/panels/hall-ui.js';
import { deedMarkup } from '../../../app/src/panels/deed.js';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const ROW = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';

test('shop pages load their files from the folder', () => {
  const payouts = read('app/shops/payouts/index.html');
  const vault = read('app/shops/vault/index.html');
  const hall = read('app/shops/hall/index.html');
  assert.match(payouts, /src="\/shops\/payouts\/payouts\.bundle\.js"/);
  assert.match(payouts, /href="\/shops\/payouts\/payouts\.css"/);
  assert.match(vault, /href="\/shops\/vault\/vault\.css"/);
  assert.match(vault, /src="\/shops\/vault\/vault\.bundle\.js"/);
  assert.match(hall, /href="\/shops\/hall\/hall\.css"/);
  assert.doesNotMatch(payouts, /src="payouts\.bundle\.js"/);
  assert.doesNotMatch(vault, /href="vault\.css"/);
  const mid = read('middleware.js');
  const serve = read('app/serve.mjs');
  assert.match(mid, /\/shops\\\/\[a-z0-9-\]\+\$/);
  assert.match(serve, /\/shops\\\/\[a-z0-9-\]\+\$/);
});

test('the bank labels the sample and does not print a full account', () => {
  assert.equal(shortId(ROW), '8e2027…61c8');
  const bank = read('app/src/panels/bank-tray.js');
  assert.match(bank, /data-testid="bank-sample"/);
  assert.match(bank, /class="choice-label" for="bank-sample"/);
  assert.match(bank, /data-testid="bank-model"/);
  assert.match(bank, /class="choice-label" for="bank-model">TEE model/);
  assert.doesNotMatch(bank, /Send privately/);
  const css = read('app/src/panels/panels.css');
  assert.match(css, /min-height:44px/);
  assert.match(css, /font:600 16px\/1\.25 system-ui,sans-serif/);
  assert.match(css, /#room \[data-testid=tee-verify\]\{margin-top:16px\}/);
  assert.match(css, /body\[data-shop=bank\] \.note/);
});

test('the hall copy control is a button and the mint record has space', () => {
  const hall = read('app/src/panels/hall-ui.js');
  assert.match(hall, /class="primary copy-id"/);
  const empty = hallMarkup(null, { accountId: ROW, displayName: 'Scholar' });
  assert.match(empty, /data-testid="hall-row-id"/);
  assert.match(empty, /8e2027…61c8/);
  assert.match(empty, /data-testid="hall-copy"/);
  const deed = deedMarkup();
  assert.match(deed, /class="deed-mint"/);
  assert.match(deed, /data-testid="deed-mint"/);
  assert.match(deed, />Mint record</);
  const css = read('app/src/panels/panels.css');
  assert.match(css, /\.deed-mint\{margin:0;padding-top:18px\}/);
  assert.match(css, /#row-form\{display:flex;flex-direction:column;gap:8px/);
});
