import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickBest, statusView } from '../../../app/src/ferry-catalog.js';
import { explainCheck } from '../../../app/src/guard-score.js';
import { queryFeed, exportCsv, verifyEntry, RECORDED } from '../../../app/src/chronicle-feed.js';
import { checkDerived, keccak256, TOLL_KEY, TOLL_ADDRESS } from '../../../app/src/toll-derive.js';
import { controlAfterMove, metadataView, DEED } from '../../../app/src/deed-control.js';
import { teeResult } from '../../../app/src/tee-view.js';
import { callsFor, diffCharter, draftFrom, readBack, PREVIEW_ROW, nearOf } from '../../../app/shops/hall/row.js';
import { receiptsFor, parseCsv, splitAssets } from '../../../app/design/D8_shops/js/payouts.js';

const read = p => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('two ferry quotes mark the larger amount out', () => {
  const rows = pickBest([
    { to: { amount: '1.0', symbol: 'ZEC' }, dry: true, privacy: 'public' },
    { to: { amount: '1.4', symbol: 'ZEC' }, dry: true, privacy: 'basic' },
  ]);
  assert.equal(rows[1].best, true);
  assert.equal(rows[0].best, false);
  const refunded = statusView({ status: 'REFUNDED', tx: 'HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw' });
  assert.equal(refunded.refund, true);
  assert.match(refunded.words, /Refunded/);
  assert.match(refunded.explorer, /nearblocks\.io/);
});

test('a guard check explains every signal', () => {
  const view = explainCheck({
    account: 'shop-moved-pay-here.near',
    verdict: 'block',
    reasons: [{ code: 'denylisted' }],
    signals: { age_ms: 48 * 3600_000, lookalike_of: 'townhall.nearcarta.near', deny: { reason: 'Refused on mainnet', evidence: ['E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ'] }, code_hash: 'abc' },
  });
  assert.equal(view.lines.length, 5);
  assert.match(view.lines.find(l => l.id === 'refusals').text, /E7KMexjS/);
  assert.equal(view.lines.find(l => l.id === 'lookalike').level, 'block');
});

test('chronicle search, filter, export and verify', () => {
  const denied = queryFeed(RECORDED, { decision: 'denied', q: 'toll' });
  assert.equal(denied.total, 1);
  assert.match(exportCsv(denied.rows), /toll/);
  const page = queryFeed(RECORDED, { page: 2, pageSize: 2 });
  assert.equal(page.page, 2);
  assert.equal(page.rows.length, 2);
  const pending = verifyEntry(RECORDED[0]);
  assert.equal(pending.ok, false);
  assert.equal(pending.pending, true);
  const v = verifyEntry(RECORDED[0], { status: { SuccessValue: '' } });
  assert.equal(v.ok, true);
  assert.match(v.url, /8WDqBeaN/);
  assert.equal(verifyEntry(RECORDED[0], { status: { Failure: {} } }).ok, false);
});

test('the toll key hashes to the recorded Base address', () => {
  const empty = [...keccak256(new Uint8Array())].map(b => b.toString(16).padStart(2, '0')).join('');
  assert.equal(empty, 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  const r = checkDerived({ publicKey: TOLL_KEY, recorded: TOLL_ADDRESS });
  assert.equal(r.ok, true);
  assert.equal(r.computed, TOLL_ADDRESS);
  assert.equal(r.chains.filter(c => c.derived).length, 1);
  assert.match(r.chains.find(c => c.chain === 'Ethereum').note, /does not pay/);
});

test('a deed move refuses the previous holder', () => {
  assert.equal(controlAfterMove({ holder: 'new.near', payer: 'new.near' }).allowed, true);
  assert.equal(controlAfterMove({ holder: 'new.near', payer: 'old.near' }).allowed, false);
  assert.equal(metadataView().standard, 'nep171');
  assert.match(DEED.allow, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
});

test('a tee result names attested or failed and links the proof file', () => {
  assert.equal(teeResult({ ok: true, model: 'm' }).label, 'attested');
  assert.equal(teeResult({ ok: false }).label, 'failed');
  assert.equal(teeResult({ ok: true }).proof, '/tee-public.json');
  const pub = JSON.parse(read('app/src/tee-public.json'));
  assert.equal(pub.label, 'attested');
});

test('a hall preview reads the new cap back and builds gas-only calls', () => {
  const draft = draftFrom(PREVIEW_ROW, { capNear: '0.003', frozen: true });
  const calls = callsFor(PREVIEW_ROW, draft);
  assert.deepEqual(calls.map(c => c.method), ['set_rules', 'set_frozen']);
  assert.ok(calls.every(c => c.deposit === '0'));
  const back = readBack(draft);
  assert.equal(nearOf(back.per_action_cap), 0.003);
  assert.equal(diffCharter(PREVIEW_ROW, back).some(d => d.field === 'per_action_cap'), true);
  assert.doesNotMatch(read('app/shops/hall/main.js'), /add_proposal/);
});

test('a payout batch keeps one receipt per row and splits the NEAR rows from the foreign ones', () => {
  const rows = parseCsv('cafe.near,0.001,NEAR\npay.near,0.2,USDC\n');
  const parts = splitAssets(rows);
  assert.equal(parts.near.length, 1);
  assert.equal(parts.usdc.length, 1);
  assert.equal(parts.usdc[0].chain, 'base');
  const receipts = receiptsFor(rows);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1].chain, 'base');
  assert.equal(receipts[0].url, '');
  assert.equal(receipts[1].asset, 'USDC');
});

test('the 3D story starts without the flat overlay', () => {
  const main = read('app/design/D9_world/js/main.js');
  assert.match(main, /storyRun=run\(story\(\)\); body\.dataset\.intro='camera'/);
  assert.match(main, /__introMotion/);
  assert.match(read('app/design/D9_world/js/fb.js'), /mountIntro/);
});
