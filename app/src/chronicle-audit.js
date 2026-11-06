// Statement digest, browser checks, and the Board v2 anchor call.
// The NEAR AI call stays on the server. A matching ed25519 signature is not an Intel TEE quote.
// The live board has `anchor(kind, digest, salt)` (contracts/charter_board/src/v2.rs): it stores
// nothing, logs one `nearcarta-board` v2 `anchor` event, and needs the visitor's own row.
// The call is signed in the browser by the visitor's session key and sent from the visitor's
// account, so no server key exists. Nothing here signs by itself.
import { teeView } from './tee-view.js';

import { verifyResponseSignature } from './panels/signature-check.js';

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

/** sha256 of raw bytes, hex. Same helper family as sha256Hex, which takes a string. */
function sha256BytesHex(bytes) {
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
  const algo = String(proof.signing_algo || '').toLowerCase();
  const sig = await verifyResponseSignature({
    text: proof.signed_text || '',
    signature: proof.signature || '',
    signingAddress: proof.signing_address || '',
    algo,
  });
  const label = algo === 'ecdsa' ? 'ECDSA' : algo === 'ed25519' ? 'Ed25519' : 'Response';
  const parts = [
    sig.ok
      ? `${label} signature over the request and response hashes: verified in this browser.`
      : `${label} signature: not verified. ${sig.why || ''}`.trim(),
    digestBound
      ? 'Canonical digest inside that request: verified.'
      : 'Canonical digest inside that request: not verified.',
    textOk
      ? 'Signed text matches the model and the two hashes: verified.'
      : 'Signed text matches the model and the two hashes: not verified.',
    proof.serverVerified
      ? 'Signer match against a TEE preflight: server-side, recorded, not re-checked in this browser.'
      : 'Signer match against a TEE preflight: server-side, not recorded.',
    'Raw model response bytes: server-side, not re-hashed in this browser.',
    'TEE quote (Intel DCAP, TCB, RTMR3): not verified in this browser. Press Verify TEE now for the live quote.',
  ];
  const ok = !!(sig.ok && digestBound && textOk);
  return { ok, protocol: ok ? (algo || 'unverified') : 'rejected', why: parts.join(' ') };
}

// The six quote fields Bank checks, plus whether this statement's signer is in that report.
export function teeNowText(proof, body) {
  const view = teeView(body || {});
  const lines = (view.steps || []).map(s => `${s.label}: ${s.ok ? 'verified' : `not verified. ${s.why || 'did not pass'}`.trim()}`);
  if (!lines.length) lines.push('NEAR AI attestation: the live check did not name a step.');
  const addr = String(proof?.signing_address || '').replace(/^ed25519:/i, '').toLowerCase();
  const models = Array.isArray(body?.models) ? body.models : [];
  const match = !!addr && models.some(m => String(m.signing_address || '').replace(/^ed25519:/i, '').toLowerCase() === addr);
  lines.push(addr
    ? (match ? 'Signer matches the live attestation.' : 'Signer was not in the live attestation.')
    : 'Signer: this statement has no signing address to match.');
  lines.push('Raw model response bytes stay on the server. This browser does not re-hash them.');
  return lines.join(' ');
}

// The board's real event, as `anchor` logs it (contracts/charter_board/src/v2.rs):
// EVENT_JSON:{"standard":"nearcarta-board","version":"2","event":"anchor",
//             "owner":"visitor.near","kind":"statement","commitment":"<hex32>","nonce":"0","time":"<ns>"}
// `commitment` is sha256(salt_bytes || digest) and is the only thing published: neither the
// salt nor the raw digest reaches the chain. Zero persistent storage; the index is the events.
export const ANCHOR_STANDARD = 'nearcarta-board';
export const ANCHOR_VERSION = '2';
export const ANCHOR_EVENT = 'anchor';
// The contract accepts 8..=64 ASCII alphanumeric. 16 hex chars is inside that range.
export const ANCHOR_SALT_LEN = 16;

/** Board `anchor` args for one bundle digest. Never a raw digest without a salt. */
export function anchorPlan({ manifest, consent = false, privateNote = '', salt = '' } = {}) {
  const note = String(privateNote || '');
  const digest = String(manifest?.digest || '');
  // Consent is decided before anything else: a note without consent must never reach the
  // board, whatever else about the request is wrong.
  if (note && !consent) {
    return { ok: false, signed: false, live: 'blocked', args: null, event: null, reason: 'Private note kept off the bundle. The raw hash was not published. Nothing was signed.' };
  }
  if (note && !salt) {
    return { ok: false, signed: false, live: 'blocked', args: null, event: null, reason: 'The salt is missing, so the private note was not committed. Nothing was signed.' };
  }
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    return { ok: false, signed: false, live: 'blocked', args: null, event: null, reason: 'Write the statement first. Nothing was signed.' };
  }
  if (salt && !/^[A-Za-z0-9]{8,64}$/.test(salt)) {
    return { ok: false, signed: false, live: 'blocked', args: null, event: null, reason: 'The salt must be 8 to 64 letters or digits for the board. Nothing was signed.' };
  }
  // No private note still commits with a generated salt: the board refuses a raw digest.
  const useSalt = salt || `${saltBytes()}`;
  const args = { kind: 'statement', digest, salt: useSalt };
  // The contract computes sha256(salt_bytes || digest_bytes) and logs only that
  // (contracts/charter_board/src/v2.rs `anchor`). The tray must use the same formula or
  // the event it reads back would never match the commitment it is looking for.
  const commitment = anchorCommitment(useSalt, digest);
  const localEvent = {
    standard: ANCHOR_STANDARD,
    version: ANCHOR_VERSION,
    event: ANCHOR_EVENT,
    owner: String(manifest?.body?.account || ''),
    kind: 'statement',
    commitment,
    digest,
  };
  return {
    ok: true,
    signed: false,
    live: 'ready',
    method: 'anchor',
    args,
    salt: useSalt,
    commitment,
    noteCommitment: note ? sha256Hex(`${useSalt}:${note}`) : '',
    event: localEvent,
    reason: 'Ready to anchor. The board logs one event and stores nothing. The session key sends it from your own account.',
  };
}

/**
 * What the board logs: sha256(salt_bytes || digest_bytes), hex.
 * `digest` is the 64-char hex the manifest produced, decoded to 32 bytes first.
 */
export function anchorCommitment(salt, digestHex) {
  const saltBytes = new TextEncoder().encode(String(salt || ''));
  const raw = hexToBytes(digestHex);
  if (!raw) return '';
  const all = new Uint8Array(saltBytes.length + raw.length);
  all.set(saltBytes, 0);
  all.set(raw, saltBytes.length);
  return sha256BytesHex(all);
}

/** The salt the board accepts. 16 hex chars, 8..=64 alphanumeric. */
function saltBytes() {
  const bytes = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(bytes);
  return [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** Read a board anchor event out of a receipt's `EVENT_JSON:` log lines. */
export function parseAnchorEvents(logs = []) {
  const out = [];
  for (const line of logs || []) {
    const text = String(line || '');
    const i = text.indexOf('EVENT_JSON:');
    if (i < 0) continue;
    let body;
    try { body = JSON.parse(text.slice(i + 'EVENT_JSON:'.length)); } catch { continue; }
    if (body?.standard !== ANCHOR_STANDARD || body?.event !== ANCHOR_EVENT) continue;
    if (!body.commitment || !body.owner) continue;
    out.push({
      standard: ANCHOR_STANDARD,
      version: String(body.version || ANCHOR_VERSION),
      event: ANCHOR_EVENT,
      owner: String(body.owner),
      kind: String(body.kind || ''),
      commitment: String(body.commitment),
      nonce: String(body.nonce ?? ''),
      time: String(body.time ?? ''),
    });
  }
  return out;
}

/** Events for one visitor from RPC receipts_outcome[].outcome.logs, in chain order. */
export function anchorEventsFromReceipts(receipts = []) {
  const out = [];
  for (const r of receipts || []) {
    const owner = r?.executor_id || r?.predecessor_id || '';
    const logs = r?.outcome?.logs || r?.outcome?.outcome?.logs || [];
    for (const e of parseAnchorEvents(logs)) out.push({ ...e, tx: r?.id || r?.receipt_id || '', owner: e.owner || owner });
  }
  return out;
}

/**
 * Rebuild the anchored index from events alone. This is the durable index: the board
 * stores nothing, so a reader re-derives every anchored statement from the chain logs.
 * The same digest anchored twice keeps the later event (chain order wins).
 */
export function rebuildIndex(events) {
  const byCommitment = {};
  const byDigest = {};
  for (const e of events || []) {
    if (e?.event !== ANCHOR_EVENT) continue;
    if (!e.commitment) continue;
    const row = { owner: e.owner || '', kind: e.kind || '', commitment: e.commitment, nonce: e.nonce || '', time: e.time || '', tx: e.tx || '' };
    byCommitment[e.commitment] = row;
    if (e.digest) byDigest[e.digest] = row;
  }
  return { byCommitment, byDigest };
}

/** Does a locally built commitment appear in the chain events for this visitor? */
export function anchorProof({ commitment, owner, events = [] } = {}) {
  const want = String(commitment || '');
  const who = String(owner || '');
  if (!want) return { ok: false, why: 'No commitment was built, so there is nothing to look for.' };
  const hit = (events || []).find(e => e?.commitment === want && (!who || e.owner === who));
  if (!hit) return { ok: false, why: 'The board has not logged this commitment yet. The transaction may still be confirming.' };
  return { ok: true, event: hit, why: `The board logged this commitment for ${hit.owner}${hit.nonce ? ` at nonce ${hit.nonce}` : ''}.` };
}
