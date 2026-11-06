// The look-alike rule, served to the browser at /guard-lookalike.js.
//
// shared/vault/attacks.js has the same function, but a module served from app/dist cannot
// resolve ../../../../shared/..., so importing it here 404s and kills the shop mount. This
// is the one browser copy, and backend/test/unit/guard-lookalike.test.js pins it equal to
// the shared implementation so the two cannot drift.
//
// The Guardhouse example payee and the Arena look-alike attack both use this: the name is
// always derived from a real account (the visitor's own, or one of their allowed payees),
// never a fixed address.

const SWAP = { a: '4', e: '3', i: '1', o: '0', l: '1', s: '5', t: '7', b: '8' };

/** A look-alike: the first swappable letter of the first label becomes a digit. Never equals the input. */
export function lookalike(account) {
  const s = String(account ?? '');
  if (!s) return '';
  const [head, ...rest] = s.split('.');
  for (let i = 0; i < head.length; i++) {
    const r = SWAP[head[i]];
    if (r) return [head.slice(0, i) + r + head.slice(i + 1), ...rest].join('.');
  }
  return [head + 'x', ...rest].join('.');
}
