// A payee on the public path is a NEAR mainnet account.
const NAMED = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT = /^[0-9a-f]{64}$/;

/** A NEAR account id: a named account, or a 64-hex implicit account. */
export function nearAccountOk(id) {
  const s = String(id || '').trim();
  return IMPLICIT.test(s) || NAMED.test(s);
}

export const NEAR_CAP = 0.005;

export function nearAmountOk(amt, cap = NEAR_CAP) {
  const n = Number(amt);
  return Number.isFinite(n) && n > 0 && n <= cap + 1e-12;
}

export function formatNear(amt) {
  const n = Number(amt);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(3);
}

export function rejectTestnetReceiver(id) {
  const s = String(id || '');
  if (!s || /\.testnet$/i.test(s) || s.toLowerCase().includes('.testnet')) {
    const err = new Error('receiver must be a mainnet account');
    err.status = 400;
    throw err;
  }
  return s;
}
