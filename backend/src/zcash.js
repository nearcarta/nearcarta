// Zcash recipient check for the Ferry. Decodes a Unified Address (ZIP 316: bech32m + F4Jumble + TLV)
// and reports which receivers it carries. A transparent recipient is public on Zcash; an Orchard-only
// UA is the shielded path (since NU6.3 an Orchard receiver is paid into the Ironwood pool, ZIP 258).
import { bech32m } from '@scure/base';
import { blake2b } from '@noble/hashes/blake2.js';

const enc = new TextEncoder();
const TYPES = { 0: 'P2PKH', 1: 'P2SH', 2: 'Sapling', 3: 'Orchard' };

function pers(tag, a, b, c) { const p = new Uint8Array(16); p.set(enc.encode(tag)); p[13] = a; p[14] = b; p[15] = c; return p; }
const H = (i, u, lenL) => blake2b(u, { dkLen: lenL, personalization: pers('UA_F4Jumble_H', i, 0, 0) });
function G(i, u, lenR) {
  const out = new Uint8Array(lenR);
  for (let j = 0, off = 0; off < lenR; j++, off += 64) {
    const h = blake2b(u, { dkLen: 64, personalization: pers('UA_F4Jumble_G', i, j & 0xff, j >> 8) });
    out.set(h.subarray(0, Math.min(64, lenR - off)), off);
  }
  return out;
}
const xor = (a, b) => a.map((v, k) => v ^ b[k]);

export function f4jumbleInv(m) {
  const lenL = Math.min(64, Math.floor(m.length / 2)), lenR = m.length - lenL;
  const c = m.subarray(0, lenL), d = m.subarray(lenL);
  const y = xor(c, H(1, d, lenL));
  const x = xor(d, G(1, y, lenR));
  const a = xor(y, H(0, x, lenL));
  const b = xor(x, G(0, a, lenR));
  const out = new Uint8Array(m.length); out.set(a); out.set(b, lenL); return out;
}

function compact(buf, i) {
  const f = buf[i];
  if (f < 0xfd) return [f, i + 1];
  if (f === 0xfd) return [buf[i + 1] | (buf[i + 2] << 8), i + 3];
  throw new Error('compactsize too large');
}

export function decodeUnifiedAddress(ua) {
  const { prefix, words } = bech32m.decode(ua, 4096);
  if (prefix !== 'u' && prefix !== 'utest') throw new Error('not a unified address');
  const raw = f4jumbleInv(Uint8Array.from(bech32m.fromWords(words)));
  const pad = raw.subarray(raw.length - 16);
  const want = new Uint8Array(16); want.set(enc.encode(prefix));
  if (!pad.every((v, k) => v === want[k])) throw new Error('bad UA padding');
  const body = raw.subarray(0, raw.length - 16);
  const receivers = [];
  for (let i = 0; i < body.length;) {
    let t, n; [t, i] = compact(body, i); [n, i] = compact(body, i);
    receivers.push(TYPES[t] || `unknown_${t}`); i += n;
    if (i > body.length) throw new Error('truncated UA');
  }
  return { network: prefix === 'u' ? 'mainnet' : 'testnet', receivers };
}

// Classify a Zcash recipient for the privacy check shown in the Ferry.
export function zcashRecipient(addr) {
  if (/^t1|^t3/.test(addr)) return { kind: 'transparent', shielded: false, receivers: ['transparent'], note: 'Transparent address: amount and recipient are public on Zcash.' };
  if (/^tex1/.test(addr)) return { kind: 'tex', shielded: false, receivers: ['transparent'], note: 'TEX address (ZIP 320): transparent-only by design.' };
  if (/^zs1/.test(addr)) return { kind: 'sapling', shielded: true, receivers: ['Sapling'], note: 'Sapling shielded address.' };
  if (/^u1|^utest1/.test(addr)) {
    const { receivers } = decodeUnifiedAddress(addr);
    const shieldedOnly = receivers.every(r => r === 'Orchard' || r === 'Sapling');
    return { kind: 'unified', shielded: shieldedOnly, receivers,
      note: shieldedOnly ? 'Unified address with shielded receivers only.' : 'Unified address that also carries a transparent receiver; a sender may pick it.' };
  }
  throw new Error('unknown Zcash address format');
}
