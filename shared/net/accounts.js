// A payee on the public path is a NEAR mainnet account.
const NAMED = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT = /^[0-9a-f]{64}$/;

/** A NEAR account id: a named account, or a 64-hex implicit account. */
export function nearAccountOk(id) {
  const s = String(id || '').trim();
  return IMPLICIT.test(s) || NAMED.test(s);
}

/** At or under the visitor's own cap. A missing cap is a no, never a default. */
export function nearAmountOk(amt, cap) {
  const n = Number(amt), c = Number(cap);
  if (cap == null || cap === '' || !Number.isFinite(c) || c <= 0) return false;
  return Number.isFinite(n) && n > 0 && n <= c + 1e-12;
}

export function formatNear(amt) {
  const n = Number(amt);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(3);
}

const MAINNET_NAMED = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+\.near$/;

/** A mainnet payee: a named .near account, or a 64-hex implicit account. */
export function mainnetReceiverOk(id) {
  const s = String(id || '').trim();
  return IMPLICIT.test(s) || MAINNET_NAMED.test(s);
}

export function requireMainnetReceiver(id) {
  const s = String(id || '').trim();
  if (!mainnetReceiverOk(s)) {
    const err = new Error('receiver must be a valid mainnet .near or implicit account');
    err.status = 400;
    throw err;
  }
  return s;
}
