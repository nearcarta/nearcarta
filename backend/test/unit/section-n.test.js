import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cfg } from '../../src/config.js';
import { rpc, _resetRpcCache } from '../../src/near.js';
import { explainCheck, verdictLine } from '../../../app/src/guard-score.js';
import { PREVIEW_ROW, readUntilChange, rowCaughtUp, waitForFinal } from '../../../app/src/panels/hall.js';
import { hallMarkup, hallSkeleton } from '../../../app/src/panels/hall-ui.js';
import { restorePlan, SESSION_KEY } from '../../../app/design/D8_shops/js/session.js';
import { addPayoutRow, formatNear } from '../../../app/design/D8_shops/js/payouts.js';

const realFetch = globalThis.fetch;
const saved = { ...cfg };
const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

function memory() {
  const box = new Map();
  return {
    getItem: (k) => (box.has(k) ? box.get(k) : null),
    setItem: (k, v) => box.set(k, String(v)),
  };
}

beforeEach(() => { _resetRpcCache(); });
afterEach(() => { globalThis.fetch = realFetch; Object.assign(cfg, saved); });

test('a warn names the empty code hash and the missing first-seen', () => {
  const view = explainCheck({
    account: 'nearcarta.near',
    verdict: 'warn',
    reasons: [
      { code: 'age_unknown', level: 'warn', text: 'account age was not returned' },
      { code: 'unconfirmed', level: 'warn', text: 'empty code hash and no account age' },
    ],
    signals: { code_hash: '11111111111111111111111111111111', age_ms: null, exists: true, allowlisted: true, prior_payments: 1 },
  });
  assert.equal(view.verdict, 'warn');
  assert.equal(view.summary, 'Warn because: no contract (code hash empty); first-seen unknown');
  assert.deepEqual(view.causes, ['no contract (code hash empty)', 'first-seen unknown']);
});

test('a block names the deny list and an allow stays one word', () => {
  const block = verdictLine({
    verdict: 'block',
    reasons: [{ level: 'block', code: 'denylisted', text: 'On the deny list' }],
  });
  assert.equal(block.summary, 'Block because: on the deny list');
  assert.equal(verdictLine({ verdict: 'allow', reasons: [] }).summary, 'Allow');
});

test('a fresh charter read skips the cache', async () => {
  cfg.rpcCacheMs = 5000;
  cfg.rpcRetries = 1;
  cfg.rpcFallbacks = [];
  let n = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { amount: String(++n) } }), { status: 200 });
  const params = { request_type: 'view_account', finality: 'final', account_id: 'row.near' };
  assert.equal((await rpc('query', params)).amount, '1');
  assert.equal((await rpc('query', params)).amount, '1');
  assert.equal((await rpc('query', params, cfg.rpc, { fresh: true })).amount, '2');
});

test('the row is read again until the cap matches the draft', async () => {
  const before = { ...PREVIEW_ROW, per_action_cap: '4000000000000000000000' };
  const draft = { ...before, per_action_cap: '3000000000000000000000' };
  assert.equal(rowCaughtUp(before, draft, before), false);
  let n = 0;
  const out = await readUntilChange({
    before,
    draft,
    read: async () => (n++ === 0 ? before : draft),
    pauseMs: 0,
    wait: async () => {},
  });
  assert.equal(out.changed, true);
  assert.equal(out.attempts, 2);
  assert.equal(out.row.per_action_cap, draft.per_action_cap);
  const status = await waitForFinal(
    async () => (n++ < 3 ? { final: false, pass: false } : { final: true, pass: true }),
    { pauseMs: 0, wait: async () => {} },
  );
  assert.equal(status.ready, true);
  assert.equal(status.ok, true);
});

test('the hall shows one signed-in line and a skeleton while the row loads', () => {
  const html = hallMarkup(PREVIEW_ROW, { accountId: 'preview.near', displayName: 'Scholar' });
  assert.equal((html.match(/Signed in/g) || []).length, 1);
  assert.match(html, /data-testid="hall-read"/);
  assert.match(html, /class="hall-meta"/);
  const empty = hallMarkup(null, { accountId: 'scholar.near', displayName: 'Scholar' });
  assert.match(empty, /Signed in as Scholar\./);
  assert.doesNotMatch(empty, /Sign in, then open/);
  assert.match(hallSkeleton(), /data-testid="hall-skel"/);
  assert.match(hallSkeleton(), /Reading your row/);
});

test('a saved account with no live wallet needs one click', () => {
  const storage = memory();
  storage.setItem(SESSION_KEY, JSON.stringify({ accountId: 'visitor.near', displayName: 'Scholar', walletId: 'nearcarta-privy' }));
  const quiet = restorePlan(storage, '');
  assert.equal(quiet.needsClick, true);
  assert.equal(quiet.accountId, 'visitor.near');
  assert.equal(quiet.walletId, 'nearcarta-privy');
  assert.match(quiet.note, /not connected/);
  const live = restorePlan(storage, 'visitor.near');
  assert.equal(live.needsClick, false);
  assert.equal(live.accountId, 'visitor.near');
  assert.equal(restorePlan(memory(), '').needsClick, false);
});

test('a new payout row is blank and the third row is the daily count', () => {
  assert.equal(formatNear(''), '');
  assert.equal(formatNear('0.001'), '0.001');
  const first = addPayoutRow([]);
  assert.equal(first.added, true);
  assert.deepEqual(first.rows, [{ to: '', amt: '' }]);
  const full = addPayoutRow([{ to: 'a.near', amt: '0.001' }, { to: 'b.near', amt: '0.001' }, { to: 'c.near', amt: '0.001' }]);
  assert.equal(full.added, false);
  assert.equal(full.rows.length, 3);
  assert.match(full.reason, /Three rows is the daily count/);
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /data-testid="payout-add"/);
  assert.doesNotMatch(deep, /\{ to: '', amt: '0\.001' \}, \{ to: '', amt: '0\.001' \}/);
});

test('a waiting button keeps its reason in the shop source', () => {
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /Comparing routes\. Waiting for the quotes\./);
  assert.match(deep, /Checking this account\./);
  const css = read('app/src/panels/panels.css');
  assert.match(css, /button:disabled,button\.primary:disabled\{opacity:1 !important;color:#2A1608 !important/);
  assert.match(css, /overflow-wrap:anywhere/);
});
