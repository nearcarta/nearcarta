import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tollMarkup } from '../../../app/src/panels/toll-room.js';
const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

const order = { id: 1, row_owner: '8e20', to: '0x4c07c97812098f595ff1611d8cb3465e591ee38a', amount: '100000000000000', asset: 'native', status: 'signed', tx_nonce: 0 };
const hash = '0xee0a64862989d56dd39ba7c35324ac5b73b41be75b4bb93af695462fdf1db36a';
const done = { order, nonce: 0, hash, paid: true, explorer: 'https://basescan.org/tx/' + hash, text: '✓ Paid on Base · 0.0001 ETH · block 56530402' };

test('F65: a finished crossing with a Base receipt shows paid, with the basescan link', () => {
  const h = tollMarkup({ live: { ok: true, recent: [{ nonce: 0, status: 'signed', tx_hash: hash, explorer: done.explorer, words: 'Signature issued for a Base transaction. Not broadcast from this page. No Base payment.' }] }, done, tab: 'split' });
  assert.match(h, /data-testid="toll-paid"/);
  assert.match(h, /✓ Paid on Base · 0\.0001 ETH · block 56530402/);
  assert.match(h, /href="https:\/\/basescan\.org\/tx\/0xee0a/);
  assert.match(h, /data-mine="1"><b>#1<\/b> paid\./);
  assert.doesNotMatch(h, /Not broadcast from this page/);
});

test('F65: no paid card without a receipt, and an open order keeps its own card', () => {
  assert.doesNotMatch(tollMarkup({ live: { ok: true }, done: { ...done, paid: false } }), /data-testid="toll-paid"/);
  assert.doesNotMatch(tollMarkup({ live: { ok: true }, done, openOrder: { ...order, status: 'open' } }), /data-testid="toll-paid"/);
});

test('F65: finishing waits for the Base receipt; a broadcast alone is not paid', () => {
  const a = read('app/design/D8_shops/js/apps.js');
  assert.match(a, /eth_getTransactionReceipt/);
  assert.match(a, /if \(hash && relay\?\.claim !== 'paid'\) relay = await waitBasePaid\(hash, cur, relay\)/);
  assert.match(a, /rc && rc\.status === 1\) return \{ \.\.\.relay, ok: true, step: 'paid', claim: 'paid'/);
  assert.match(read('app/design/D8_shops/js/shopui.js'), /const paid = o\.relay\?\.claim === 'paid'; \/\/ F65/);
  assert.match(read('app/src/panels/toll-room.js'), /method: 'sign_cross'/);
});
