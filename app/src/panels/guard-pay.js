// Guarded pay. A verdict is bound to the typed payment. It is not a signature
// and it is not an on-chain TEE proof.
// NEAR AI verification (algorithm UNVERIFIED until a signed fixture is checked):
// https://docs.near.ai/cloud/verification
// https://github.com/nearai/nearai-cloud-verifier
// OutLayer yield/resume is not called. https://app.outlayer.ai/docs/getting-started
// Access keys cannot attach a deposit: https://docs.near.org/protocol/accounts-contracts/access-keys

export const VERIFIER_INTERFACE = 'nearcarta.guard.verifier';
export const VERIFIER_VERSION = 1;
/** No funded guard account. Do not claim on-chain enforcement. */
export const LIVE_ENFORCEMENT = 'blocked';
export const HOLD_MS = 10 * 60 * 1000;

const UNKNOWN_CODES = new Set(['age_unknown', 'code_unknown', 'account_missing', 'unconfirmed', 'index_unknown', 'no_history']);

export function canonicalContext(fields = {}) {
  return JSON.stringify({
    v: VERIFIER_VERSION,
    payee: String(fields.payee || '').toLowerCase(),
    chain: String(fields.chain || 'near').toLowerCase(),
    asset: String(fields.asset || 'NEAR').toUpperCase(),
    amount: String(fields.amount || ''),
    invoice: String(fields.invoice || ''),
    row: String(fields.row || ''),
    keyEpoch: String(fields.keyEpoch || ''),
    policyVersion: String(fields.policyVersion || ''),
  });
}

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Binding digest of the typed payment. Not a provider signature. */
export function contextDigest(fields) {
  const text = canonicalContext(fields);
  return fnv(text) + fnv(text.split('').reverse().join(''));
}

export function classifyCheck(check) {
  const reasons = Array.isArray(check?.reasons) ? check.reasons : [];
  const codes = new Set(reasons.map(r => r && r.code).filter(Boolean));
  if (check?.verdict === 'block' || codes.has('denylisted') || codes.has('lookalike')) return 'block';
  const unknown = !check || check.verdict == null || [...codes].some(c => UNKNOWN_CODES.has(c));
  if (unknown) return 'unknown';
  if (check.verdict === 'allow') return 'allow';
  if (check.verdict === 'warn') return 'warn';
  return 'unknown';
}

export function bindVerdict(input = {}, now = Date.now()) {
  const fields = {
    payee: input.payee,
    chain: input.chain || 'near',
    asset: input.asset || 'NEAR',
    amount: input.amount || '',
    invoice: input.invoice || '',
    row: input.row || '',
    keyEpoch: input.keyEpoch || '',
    policyVersion: input.policyVersion || '',
  };
  const digest = contextDigest(fields);
  const verdict = classifyCheck(input.check);
  return {
    ...fields,
    id: 'hold_' + digest.slice(0, 8),
    digest,
    verdict,
    release: verdict === 'unknown' ? 'warn' : verdict,
    expiresAt: now + HOLD_MS,
    live: LIVE_ENFORCEMENT,
    bound: true,
    version: VERIFIER_VERSION,
  };
}

export function contextMatches(bound, fields) {
  if (!bound?.digest) return false;
  return bound.digest === contextDigest(fields);
}

function refundOnce(book, hold, now, why) {
  if (book.refunds.has(hold.id)) {
    return { ok: false, status: 'refunded', signed: false, duplicate: true, cinema: false, hint: 'Already refunded. Nothing else moves.' };
  }
  const refund = {
    id: hold.id,
    status: 'refunded',
    amount: hold.amount,
    asset: hold.asset,
    payee: hold.payee,
    chain: hold.chain,
    row: hold.row,
    at: now,
    why,
    destination: 'visitor-row',
    boardTransfer: false,
    signed: false,
    live: LIVE_ENFORCEMENT,
    tx: null,
  };
  book.refunds.set(hold.id, refund);
  book.holds.delete(hold.id);
  return {
    ok: true, status: 'refunded', signed: false, refund, cinema: false, tx: null, live: LIVE_ENFORCEMENT,
    hint: 'Refunded to your row once. A transfer back to the board is not this refund. Nothing was signed.',
  };
}

export function createLedger() {
  const book = { holds: new Map(), refunds: new Map(), spent: new Set() };
  return {
    book,
    pay(bound, now = Date.now()) {
      if (!bound?.bound) return { ok: false, signed: false, status: 'refused', cinema: false, hint: 'Check the payee first. Nothing was signed.' };
      if (now > bound.expiresAt) return { ok: false, signed: false, status: 'expired', cinema: false, hint: 'That check expired. Check the payee again. Nothing was signed.' };
      if (book.spent.has(bound.digest)) return { ok: false, signed: false, status: 'replay', cinema: false, hint: 'That verdict was already used. Check again. Nothing was signed.' };
      if (bound.chain && bound.chain !== 'near') {
        return { ok: false, signed: false, status: 'blocked', cinema: false, hint: 'Foreign spend stays blocked until Toll consumes this verdict. Nothing was signed.' };
      }
      if (bound.release === 'block') {
        book.spent.add(bound.digest);
        return { ...refundOnce(book, { ...bound, status: 'blocked', at: now }, now, 'block'), verdict: 'block' };
      }
      if (bound.release === 'warn' || bound.verdict === 'unknown') {
        const hold = { ...bound, status: 'held', at: now, deadline: bound.expiresAt };
        book.holds.set(bound.id, hold);
        return {
          ok: true, signed: false, status: 'held', hold, needsHuman: true, cinema: false, tx: null, live: LIVE_ENFORCEMENT,
          hint: 'Held until you press Confirm. The agent cannot release it.',
        };
      }
      book.spent.add(bound.digest);
      const forward = { payee: bound.payee, chain: bound.chain, asset: bound.asset, amount: bound.amount, row: bound.row };
      return {
        ok: true, signed: false, status: 'prepared', live: LIVE_ENFORCEMENT, forward, cinema: false, tx: null, verdict: 'allow',
        hint: 'Allow matches this payee and amount. The guard contract is not deployed yet, so nothing was signed.',
      };
    },
    confirm(id, { actor, intentDigest } = {}, now = Date.now()) {
      const hold = book.holds.get(id);
      if (!hold) return { ok: false, signed: false, status: 'missing', cinema: false, hint: 'Nothing is held.' };
      if (actor !== 'human') return { ok: false, signed: false, status: 'refused', cinema: false, hint: 'The agent cannot confirm a warning. Press Confirm yourself.' };
      if (intentDigest !== hold.digest) return { ok: false, signed: false, status: 'mismatch', cinema: false, hint: 'That confirm does not match the held payment.' };
      if (now > hold.deadline) return refundOnce(book, hold, now, 'expired');
      book.holds.delete(id);
      book.spent.add(hold.digest);
      return {
        ok: true, signed: false, status: 'prepared', live: LIVE_ENFORCEMENT, cinema: false, tx: null,
        forward: { payee: hold.payee, chain: hold.chain, asset: hold.asset, amount: hold.amount, row: hold.row },
        hint: 'You confirmed the warning. The guard contract is not deployed yet, so nothing was signed.',
      };
    },
    cancel(id, now = Date.now()) {
      const hold = book.holds.get(id);
      if (!hold) {
        if (book.refunds.has(id)) return { ok: false, signed: false, status: 'refunded', duplicate: true, cinema: false, hint: 'Already refunded.' };
        return { ok: false, signed: false, status: 'missing', cinema: false, hint: 'Nothing is held.' };
      }
      return refundOnce(book, hold, now, 'cancel');
    },
    expire(now = Date.now()) {
      const out = [];
      for (const hold of [...book.holds.values()]) {
        if (now > hold.deadline) out.push(refundOnce(book, hold, now, 'timeout'));
      }
      return out;
    },
  };
}

export function nearToYocto(amount) {
  const s = String(amount ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const padded = (frac + '000000').slice(0, 6);
  return ((BigInt(whole) * 1000000n) + BigInt(padded)) * (10n ** 18n);
}
