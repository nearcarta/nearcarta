// One path shape for a visitor row on a foreign chain.
// The address is whatever the signer returned. This module does not invent one.

export function rowPath(owner, chain = 'base') {
  const id = String(owner || '').trim().toLowerCase();
  const name = String(chain || '').trim().toLowerCase();
  if (!id || name !== 'base') return '';
  return `row:${id}:base`;
}

export function missingCross(intent) {
  const to = String(intent?.to || '');
  // EIP-55 addresses are mixed case, and that is what a wallet or explorer gives a visitor
  // to copy. Requiring lowercase rejected them:
  //   0x0000...dEaD and 0xBDfC3e0d...C3b2A1 both failed, only all-lowercase passed.
  // The case is a checksum, not part of the value, so accept either and hand back lowercase.
  if (!to) return 'Name a Base address, 0x and 40 hex. Nothing was signed.';
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return 'Name a Base address, 0x and 40 hex. Nothing was signed.';
  if (intent?.asset !== 'native' && intent?.asset !== 'usdc') return 'Name the asset, ETH or USDC. Nothing was signed.';
  if (intent?.amount == null || intent.amount === '' || Number(intent.amount) <= 0) return 'Name the amount. Nothing was signed.';
  return '';
}

/** The address as the chain wants it: lowercase, with its 0x. */
export const normaliseEvm = hex => String(hex || '').trim().toLowerCase();
