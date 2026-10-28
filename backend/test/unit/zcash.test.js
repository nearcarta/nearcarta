import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeUnifiedAddress, zcashRecipient } from '../../src/zcash.js';

const vectors = JSON.parse(readFileSync(new URL('../fixtures/zip316_vectors.json', import.meta.url)));
const ORCHARD_ONLY = 'u1naczqa5m5nefpyqnhs8h3dw8un8z8us45xwgfh4ees95mayyru9snc33dkfk2dc27r5syu4uveyyd5dt8wwad89kpc3f8cah055lm0ex';

test('ZIP 316 official vectors decode to the expected receivers', () => {
  for (const v of vectors) {
    const got = decodeUnifiedAddress(v.ua).receivers.filter(r => !r.startsWith('unknown_')).sort();
    assert.deepEqual(got, v.expect, v.ua.slice(0, 20));
  }
});

test('Orchard-only UA is classified shielded', () => {
  const r = zcashRecipient(ORCHARD_ONLY);
  assert.equal(r.shielded, true);
  assert.deepEqual(r.receivers, ['Orchard']);
});

test('UA with a transparent receiver is not shielded-only', () => {
  const v = vectors.find(x => x.expect.includes('P2PKH'));
  assert.equal(zcashRecipient(v.ua).shielded, false);
});

test('t1 and tex addresses are public', () => {
  assert.equal(zcashRecipient('t1Nk7gi97dKeY7WAU3ryJnSDCoqp7VDaXzC').shielded, false);
  assert.equal(zcashRecipient('tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte').kind, 'tex');
});

test('a one-character change breaks the bech32m checksum', () => {
  const bad = ORCHARD_ONLY.slice(0, -1) + (ORCHARD_ONLY.at(-1) === 'x' ? 'y' : 'x');
  assert.throws(() => decodeUnifiedAddress(bad));
});

test('unknown formats are refused', () => {
  assert.throws(() => zcashRecipient('0xabc'));
});
