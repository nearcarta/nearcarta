// Statement digest, browser checks, and the Board v2 anchor contract.
// The NEAR AI call stays on the server. A matching ed25519 signature is not an Intel TEE quote.
// The live board contract has no anchor method. Nothing here signs or spends.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[t] + w[t]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(n => n.toString(16).padStart(8, '0')).join('');
}

function hexToBytes(hex) {
  const s = String(hex || '').trim().replace(/^0x/, '');
  if (!s || s.length % 2) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const n = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(n)) return null;
    out[i] = n;
  }
  return out;
}

export function canonicalManifest({ account = '', period = {}, rules = null, rows = [], statement = '', model = 'none', commitment = '' } = {}) {
  const body = {
    account: String(account || ''),
    period: { from: String(period.from || ''), to: String(period.to || '') },
    rules: rules?.version ? { version: String(rules.version) } : { version: 'missing' },
    receipts: [...new Set((rows || []).map(r => r.h).filter(Boolean))].sort(),
    model: String(model || 'none'),
    statement: String(statement || ''),
    commitment: String(commitment || ''),
  };
  const text = JSON.stringify(body);
  return { body, text, digest: sha256Hex(text) };
}

export function bundleDigest({ account = '', period = {}, rows = [] } = {}) {
  return canonicalManifest({ account, period, rows, statement: '', model: 'none' }).digest;
}

export function ed25519Hex(address) {
  return String(address || '').trim().replace(/^ed25519:/i, '');
}

export function writeStatement({ account = '', period = {}, rows = [], rules = null, totals } = {}) {
  const t = totals || { delivered: 0, refunded: 0, attempted: 0 };
  const rulesLine = rules?.version
    ? `Rules version ${rules.version}.`
    : 'Historic rules: missing. This statement does not claim a rule version it did not read.';
  const text = [
    `Account ${account || '(none)'} from ${period.from || 'the start'} to ${period.to || 'now'}.`,
    `Delivered ${t.delivered}. Refunded ${t.refunded}. Attempted ${t.attempted}.`,
    rulesLine,
    'Local fallback. Not a NEAR AI signature.',
  ].join(' ');
  return { text, mode: 'local-fallback', signature: '', model: 'none', status: 'Nothing was signed. Local fallback. Not a NEAR AI signature.' };
}

export async function verifyEd25519(message, signatureHex, publicKeyHex) {
  try {
    const subtle = globalThis.crypto?.subtle;
    const pub = hexToBytes(publicKeyHex);
    const sig = hexToBytes(signatureHex);
    if (!subtle || !pub || !sig) return { ok: false, protocol: 'unverified', why: 'ed25519 verify is not available here.' };
    const key = await subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    const ok = await subtle.verify({ name: 'Ed25519' }, key, sig, new TextEncoder().encode(String(message)));
    return { ok, protocol: ok ? 'ed25519' : 'rejected', why: ok ? '' : 'The signature does not match the statement.' };
  } catch {
    return { ok: false, protocol: 'unverified', why: 'ed25519 verify is not available here.' };
  }
}

export async function verifyBundle({ manifestText = '', statement = '', digest = '', signature = '', publicKey = '' } = {}) {
  let parsed;
  try { parsed = JSON.parse(manifestText); }
  catch { return { ok: false, protocol: 'rejected', why: 'The manifest is not valid JSON.' }; }
  const reasons = [];
  if (statement != null && parsed.statement !== statement) reasons.push('The statement text does not match the manifest.');
  const again = sha256Hex(manifestText);
  if (digest && again !== digest) reasons.push('The digest does not match the manifest.');
  if (!digest && again !== sha256Hex(manifestText)) reasons.push('The digest does not match the manifest.');
  const rulesMissing = !parsed.rules || parsed.rules.version === 'missing';
  if (signature) {
    const sig = await verifyEd25519(parsed.statement || '', signature, publicKey);
    if (!sig.ok) reasons.push(sig.why || 'The signature does not match the statement.');
    if (sig.protocol === 'unverified') reasons.push(sig.why);
  }
  const hard = reasons.filter(Boolean);
  if (hard.length) return { ok: false, protocol: 'rejected', why: hard.join(' ') };
  const rulesNote = rulesMissing ? ' Historic rules: missing.' : '';
  if (!signature) {
    return { ok: true, protocol: 'unverified', why: `The digest matches this statement.${rulesNote} No signature was supplied. This is not a NEAR AI TEE attestation.` };
  }
  return { ok: true, protocol: 'ed25519', why: `The ed25519 signature matches this statement.${rulesNote} The NEAR AI TEE binding is unverified.` };
}

function signedTextOf(proof) {
  if (proof?.signature_kind === 'gateway') return `${proof.reqSha}:${proof.respSha}`;
  return `${proof?.model || ''}:${proof?.reqSha || ''}:${proof?.respSha || ''}`;
}

// Browser check for a NEAR AI signature. The Intel quote is not verified here.
export async function verifyNearAi({ manifestText = '', statement = '', digest = '', proof = null } = {}) {
  const base = await verifyBundle({ manifestText, statement, digest });
  if (!base.ok) return base;
  const mode = proof?.mode || 'local-fallback';
  if (mode !== 'near-ai') {
    return {
      ok: true,
      protocol: 'local-fallback',
      why: 'Local fallback. Not a NEAR AI signature. Ed25519: not present. Canonical digest: not signed. TEE quote (Intel DCAP, TCB, RTMR3): not verified in this browser.',
    };
  }
  let parsed = {};
  try { parsed = JSON.parse(manifestText); } catch { parsed = {}; }
  const bound = bundleDigest({
    account: parsed.account || '',
    period: parsed.period || {},
    rows: (parsed.receipts || []).map(h => ({ h })),
  });
  const requestBody = String(proof.requestBody || '');
  const reqSha = requestBody ? sha256Hex(requestBody) : '';
  const digestBound = !!proof.digest && proof.digest === bound && requestBody.includes(proof.digest) && reqSha === proof.reqSha;
  const textOk = String(proof.signed_text || '') === signedTextOf(proof);
  const sig = await verifyEd25519(proof.signed_text || '', proof.signature || '', ed25519Hex(proof.signing_address));
  const parts = [
    sig.ok
      ? 'Ed25519 signature over the request and response hashes: verified.'
      : `Ed25519 signature: not verified. ${sig.why || ''}`.trim(),
    digestBound
      ? 'Canonical digest inside that request: verified.'
      : 'Canonical digest inside that request: not verified.',
    textOk
      ? 'Signed text matches the model and the two hashes: verified.'
      : 'Signed text matches the model and the two hashes: not verified.',
    proof.serverVerified
      ? 'Server signer match against a TEE preflight: recorded, not re-checked in this browser.'
      : 'Server signer match against a TEE preflight: not recorded.',
    'Raw model response bytes: not re-hashed in this browser.',
    'TEE quote (Intel DCAP, TCB, RTMR3): not verified in this browser.',
  ];
  const ok = !!(sig.ok && digestBound && textOk);
  return { ok, protocol: ok ? 'ed25519' : 'rejected', why: parts.join(' ') };
}

// Board v2 event, when that contract exists:
// { standard:'nearcarta', version:'1', event:'chronicle_anchor',
//   data:[{ row_owner, kind:'statement', digest, nonce, time, version:1, commitment }] }
// Zero persistent storage. The index is rebuilt from the events.
export function anchorPlan({ manifest, consent = false, privateNote = '', salt = '' } = {}) {
  const note = String(privateNote || '');
  let commitment = '';
  if (note) {
    if (!consent) {
      return { ok: false, signed: false, live: 'blocked', event: null, reason: 'Private note kept off the bundle. The raw hash was not published. Nothing was signed.' };
    }
    if (!salt) {
      return { ok: false, signed: false, live: 'blocked', event: null, reason: 'The salt is missing, so the private note was not committed. Nothing was signed.' };
    }
    commitment = sha256Hex(`${salt}:${note}`);
  }
  if (!manifest?.digest) {
    return { ok: false, signed: false, live: 'blocked', event: null, reason: 'Write the statement first. Nothing was signed.' };
  }
  const event = {
    standard: 'nearcarta',
    version: '1',
    event: 'chronicle_anchor',
    data: [{
      row_owner: manifest.body?.account || '',
      kind: 'statement',
      digest: manifest.digest,
      nonce: String((manifest.body?.receipts || []).length),
      time: '',
      version: 1,
      commitment: commitment || null,
    }],
  };
  return {
    ok: false,
    signed: false,
    live: 'blocked',
    event,
    commitment,
    reason: 'Live anchor blocked. Board v2 has no anchor method on this contract. The bundle was downloaded. Nothing was signed.',
  };
}

export function rebuildIndex(events) {
  const byDigest = {};
  for (const e of events || []) {
    if (e?.event !== 'chronicle_anchor') continue;
    for (const row of e.data || []) if (row?.digest) byDigest[row.digest] = row;
  }
  return byDigest;
}
