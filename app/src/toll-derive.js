// Check a chain-signature public key against the address it derives.
// Keccak-256 of the 64-byte key, last 20 bytes, is the account on an Ethereum-style chain.
// This runs in the browser. It does not ask the chain to sign.

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function rotl(x, n) {
  if (!n) return x;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & 0xffffffffffffffffn;
}

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
      const C = [0n, 0n, 0n, 0n, 0n];
      for (let x = 0; x < 5; x++) C[x] = st[x] ^ st[x + 5] ^ st[x + 10] ^ st[x + 15] ^ st[x + 20];
      const D = C.map((_, x) => C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1));
      const B = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(st[x + 5 * y] ^ D[x], ROT[x][y]);
      }
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

export function b58decode(s) {
  const bytes = [0];
  for (const ch of String(s)) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error('bad base58');
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of String(s)) { if (ch === '1') bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}

export function addressFromKey(b58) {
  const raw = b58decode(String(b58).replace(/^secp256k1:/, ''));
  const hash = keccak256(raw);
  const hex = [...hash.subarray(12)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { bytes: raw.length, address: '0x' + hex };
}

export const TOLL_KEY = 'secp256k1:26swhQicqiPZBJamrbHX2icEjv8FbcPGw9Cox4c3fu36S2f8MB2d1ZvrocJp3mTcqVH9BQ6of3UXX2WRj2WFv59V';
export const TOLL_ADDRESS = '0x4c07c97812098f595ff1611d8cb3465e591ee38a';

export const TOLL_CHAINS = [
  { chain: 'Base', path: 'base-1', chainId: 8453, derived: true },
  { chain: 'Ethereum', path: 'ethereum-1', chainId: 1, derived: false },
  { chain: 'Arbitrum', path: 'arbitrum-1', chainId: 42161, derived: false },
];

/** Compare the MPC key with the recorded address. Other chains are listed and not paid. */
export function checkDerived({ publicKey, recorded }) {
  let computed = '';
  let ok = false;
  let error = '';
  try {
    computed = addressFromKey(publicKey).address;
    ok = computed.toLowerCase() === String(recorded || '').toLowerCase();
  } catch (e) { error = e.message; }
  return {
    ok,
    computed,
    recorded: recorded || '',
    error,
    text: ok
      ? 'The key hashes to the recorded address. This page checked that in the browser.'
      : 'The key does not hash to the recorded address.',
    chains: TOLL_CHAINS.map(c => ({
      ...c,
      address: c.derived ? (ok ? computed : recorded) : '',
      note: c.derived ? 'Recorded path on this toll contract.' : 'Not derived for this contract. This gate does not pay that chain.',
    })),
  };
}
