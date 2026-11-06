// Recover an Ethereum-style address from a NEAR AI response signature, in the browser.
// NEAR AI's /v1/signature can answer with signing_algo "ecdsa" (secp256k1 over the EIP-191 personal
// message) or "ed25519" (a 32-byte public key). docs.near.ai/cloud/verification/cloud-api/response-signatures
// says: for ecdsa recover the EIP-191 signer and compare it with signing_address; for ed25519 verify the
// UTF-8 bytes of text against signing_address. This module does exactly that, with no network call.
//
// Keccak-256 runs here rather than through a dependency: the browser has no SHA-3 in WebCrypto, and this
// file is also imported by the unit tests under Node. secp256k1 public-key recovery is ~100 lines of
// BigInt arithmetic on the same curve the signature uses.

const MASK = (1n << 256n) - 1n;
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

const mod = (a, m = P) => { const r = a % m; return r < 0n ? r + m : r; };
const big = hex => BigInt('0x' + String(hex).replace(/^0x/i, ''));

function invert(a, m = P) {
  let [lo, hi, x0, x1] = [mod(a, m), m, 1n, 0n];
  while (lo > 1n) {
    const q = hi / lo;
    [lo, hi] = [hi - q * lo, lo];
    [x0, x1] = [x1 - q * x0, x0];
  }
  return mod(x0, m);
}

function add(p1, p2) {
  if (!p1) return p2;
  if (!p2) return p1;
  if (p1[0] === p2[0] && mod(p1[1] + p2[1]) === 0n) return null;
  const lam = p1[0] === p2[0] && p1[1] === p2[1]
    ? mod(3n * p1[0] * p1[0] * invert(2n * p1[1]))
    : mod((p2[1] - p1[1]) * invert(p2[0] - p1[0]));
  const x = mod(lam * lam - p1[0] - p2[0]);
  return [x, mod(lam * (p1[0] - x) - p1[1])];
}

function multiply(point, k) {
  let out = null, addend = point;
  while (k > 0n) {
    if (k & 1n) out = add(out, addend);
    addend = add(addend, addend);
    k >>= 1n;
  }
  return out;
}

const hex32 = v => v.toString(16).padStart(64, '0');
const bytesOf = input => {
  if (input instanceof Uint8Array) return input;
  const s = String(input || '').replace(/^0x/i, '');
  if (!s || s.length % 2 || /[^0-9a-f]/i.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const hexOf = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

// ---- Keccak-256 (the pre-NIST padding Ethereum uses; WebCrypto only has SHA-3) ----
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
const rotl = (x, n) => (n ? ((x << BigInt(n)) | (x >> BigInt(64 - n))) & 0xffffffffffffffffn : x);

export function keccak256(data) {
  const rate = 136;
  const st = new BigUint64Array(25);
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const absorb = block => {
    for (let i = 0; i < 17; i++) {
      let v = 0n;
      for (let b = 0; b < 8; b++) v |= BigInt(block[i * 8 + b] || 0) << BigInt(8 * b);
      st[i] ^= v;
    }
    for (let round = 0; round < 24; round++) {
      const C = [0, 1, 2, 3, 4].map(x => st[x] ^ st[x + 5] ^ st[x + 10] ^ st[x + 15] ^ st[x + 20]);
      const D = C.map((_, x) => C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1));
      const B = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(st[x + 5 * y] ^ D[x], ROT[x][y]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        const i = x + 5 * y;
        st[i] = B[i] ^ ((~B[((x + 1) % 5) + 5 * y]) & B[((x + 2) % 5) + 5 * y]);
      }
      st[0] ^= RC[round];
    }
  };
  let off = 0;
  while (off + rate <= buf.length) { absorb(buf.subarray(off, off + rate)); off += rate; }
  const last = new Uint8Array(rate);
  last.set(buf.subarray(off));
  last[buf.length - off] ^= 0x01;
  last[rate - 1] ^= 0x80;
  absorb(last);
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let v = st[i];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(v & 0xffn); v >>= 8n; }
  }
  return out;
}

/** The EIP-191 personal-message hash: keccak256("\x19Ethereum Signed Message:\n" + len + text). */
export function eip191Hash(text) {
  const body = new TextEncoder().encode(String(text ?? ''));
  const head = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head); all.set(body, head.length);
  return keccak256(all);
}

/** Address from an uncompressed or compressed public key: keccak256(x||y)[12:]. */
export function addressFromPublicKey(publicKey) {
  let bytes = bytesOf(publicKey);
  if (!bytes) return '';
  if (bytes.length === 65 && bytes[0] === 4) bytes = bytes.subarray(1);
  if (bytes.length === 33) {
    // compressed point: y = sqrt(x^3 + 7) with the parity bit
    const x = big(hexOf(bytes.subarray(1)));
    let y = mod(x * x * x + 7n);
    y = modPow(y, (P + 1n) / 4n, P);
    if ((y & 1n) !== BigInt(bytes[0] & 1)) y = mod(-y, P);
    bytes = bytesOf(hex32(x) + hex32(y));
  }
  if (!bytes || bytes.length !== 64) return '';
  return '0x' + hexOf(keccak256(bytes).subarray(12));
}

function modPow(base, exp, m) {
  let out = 1n, b = mod(base, m), e = exp;
  while (e > 0n) { if (e & 1n) out = (out * b) % m; b = (b * b) % m; e >>= 1n; }
  return out;
}

/** Recover the signer of a 65-byte signature over a 32-byte digest. Tries r||s||v and v||r||s. */
export function recoverCandidates(digest, signature) {
  const sig = bytesOf(signature);
  if (!sig || sig.length !== 65) return [];
  const e = mod(big(hexOf(Array.from(digest))));
  const isRec = v => v === 0 || v === 1 || v === 27 || v === 28;
  const layouts = [];
  if (isRec(sig[64])) layouts.push({ r: sig.subarray(0, 32), s: sig.subarray(32, 64), v: sig[64] });
  if (isRec(sig[0])) layouts.push({ r: sig.subarray(1, 33), s: sig.subarray(33, 65), v: sig[0] });
  const out = [];
  for (const parts of layouts) {
    const recid = parts.v >= 27 ? parts.v - 27 : parts.v;
    const r = big(hexOf(parts.r));
    const s = big(hexOf(parts.s));
    if (r <= 0n || r >= N || s <= 0n || s >= N) continue;
    const x = r;
    const ySq = mod(x * x * x + 7n);
    let y = modPow(ySq, (P + 1n) / 4n, P);
    if (mod(y * y) !== ySq) continue;
    if ((y & 1n) !== BigInt(recid)) y = mod(-y, P);
    const rInv = invert(r, N);
    const q = add(multiply([GX, GY], mod(-e * rInv, N)), multiply([x, y], mod(s * rInv, N)));
    if (!q) continue;
    out.push('0x' + hexOf(keccak256(bytesOf(hex32(q[0]) + hex32(q[1]))).subarray(12)));
  }
  return out;
}

/** The first layout that recovers a signer. Kept for callers that only need an address. */
export function recoverAddress(digest, signature) {
  const sig = bytesOf(signature);
  if (!sig || sig.length !== 65) return { ok: false, why: 'The signature is not 65 bytes.' };
  const [address] = recoverCandidates(digest, signature);
  if (!address) return { ok: false, why: 'The signature recovered no key.' };
  return { ok: true, address };
}

/**
 * The ECDSA branch on its own: recover the EIP-191 signer and compare it with the address. Sync.
 * Every plausible layout is tried, and only an address equal to the attested one counts as a pass,
 * so a misread byte order can never produce a false pass or a false accusation.
 */
export function recoverEcdsaSigner({ text, signature, signingAddress } = {}) {
  const address = String(signingAddress || '').replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(address)) return { ok: false, why: 'The signing address is not a 20-byte ECDSA address.' };
  const sig = bytesOf(signature);
  if (!sig || sig.length !== 65) return { ok: false, why: 'The ECDSA signature is not 65 bytes.' };
  const candidates = recoverCandidates(eip191Hash(text), sig);
  if (!candidates.length) return { ok: false, why: 'The signature recovered no key.' };
  const hit = candidates.find(a => a.slice(2).toLowerCase() === address);
  if (!hit) return { ok: false, recovered: candidates[0], why: 'The recovered address is not the attested signing address.' };
  return { ok: true, recovered: hit, why: '' };
}

/**
 * Check the response signature the way docs.near.ai names it. `algo` comes from the response, never guessed
 * from the address length: an ecdsa address is 20 bytes, an ed25519 key is 32.
 */
export async function verifyResponseSignature({ text, signature, signingAddress, algo } = {}) {
  const algorithm = String(algo || '').toLowerCase();
  if (algorithm !== 'ecdsa' && algorithm !== 'ed25519') {
    return { ok: false, algo: algorithm, why: 'The response did not name ed25519 or ecdsa, so this browser did not check it.' };
  }
  if (typeof text !== 'string' || !text) return { ok: false, algo: algorithm, why: 'The signed text is missing.' };
  const address = String(signingAddress || '').replace(/^0x/i, '').toLowerCase();
  if (algorithm === 'ecdsa') {
    const out = recoverEcdsaSigner({ text, signature, signingAddress: address });
    return { ...out, algo: algorithm };
  }
  const key = bytesOf(address);
  const sig = bytesOf(signature);
  if (!key || key.length !== 32) return { ok: false, algo: algorithm, why: 'The signing address is not a 32-byte ed25519 key.' };
  if (!sig || sig.length !== 64) return { ok: false, algo: algorithm, why: 'The ed25519 signature is not 64 bytes.' };
  try {
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, cryptoKey, sig, new TextEncoder().encode(text));
    return ok ? { ok: true, algo: algorithm, why: '' } : { ok: false, algo: algorithm, why: 'This browser rejected the ed25519 signature.' };
  } catch (err) {
    return { ok: false, algo: algorithm, why: err?.message || 'This browser could not check the signature.' };
  }
}

/** One honest sentence for the line, per algorithm. A failed check says so; it never claims a pass. */
export function signatureLine({ ok, algo, recovered, why, checked = true } = {}) {
  const a = String(algo || '').toLowerCase();
  if (!checked) {
    return `No response signature was checked${a ? ` (${a.toUpperCase()} was named in the report)` : ''}${why ? `. ${why}` : '.'}`;
  }
  if (a === 'ecdsa') {
    return ok
      ? 'ECDSA signature recovered in your browser matches the attested signing address'
      : `ECDSA signature did not recover to the attested signing address${recovered ? ` (recovered ${recovered})` : ''}${why ? `. ${why}` : ''}`;
  }
  if (a === 'ed25519') {
    return ok
      ? 'ed25519 signature checked in your browser with the attested public key: valid'
      : `ed25519 signature checked in your browser with the attested public key: not valid${why ? `. ${why}` : ''}`;
  }
  return `No signature algorithm was named, so this browser did not check the response${why ? `. ${why}` : ''}`;
}

/** What ran where, per algorithm. Only names a browser check that actually ran. */
export function checkSplit(algo) {
  const a = String(algo || '').toLowerCase();
  if (a === 'ecdsa') {
    return 'Checked in this browser: the ECDSA signature, recovered from the EIP-191 message and compared with the attested signing address. Checked on the server: the model report, the Intel TDX quote, the GPU quote, the fresh nonce, and that the signing address is bound to the quote.';
  }
  if (a === 'ed25519') {
    return 'Checked in this browser: the ed25519 signature over the signed text, with the attested public key. Checked on the server: the model report, the Intel TDX quote, the GPU quote, the fresh nonce, and that the signing address is bound to the quote.';
  }
  return 'Checked on the server: the model report, the Intel TDX quote, the GPU quote, the fresh nonce, and that the signing address is bound to the quote. This browser did not check a response signature.';
}

/** The address as returned, and whether it matches the algorithm's size. No shortening, no guessing. */
export function signerIdentity({ signingAddress, algo } = {}) {
  const raw = String(signingAddress || '').trim();
  const a = String(algo || '').toLowerCase();
  const body = raw.replace(/^0x/i, '');
  const bytes = /^[0-9a-f]*$/i.test(body) && body.length % 2 === 0 ? body.length / 2 : -1;
  const shapeOk = a === 'ecdsa' ? bytes === 20 : a === 'ed25519' ? bytes === 32 : false;
  return {
    algo: a,
    shown: raw,
    bytes,
    ok: !!raw && shapeOk,
    label: a === 'ecdsa' ? 'ECDSA signing address' : a === 'ed25519' ? 'ed25519 public key' : 'Signing address',
    why: !raw ? 'The report carried no signing address.' : shapeOk ? '' : a
      ? `A ${a} address must be ${a === 'ecdsa' ? 20 : 32} bytes; this one is ${bytes} bytes.`
      : 'The report named no signature algorithm, so the address cannot be read.',
  };
}
