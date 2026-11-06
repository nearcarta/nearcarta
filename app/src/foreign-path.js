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
  if (!to) return 'Name a Base address, 0x and 40 hex. Nothing was signed.';
  if (!/^0x[0-9a-f]{40}$/.test(to)) return 'Name a Base address, 0x and 40 hex. Nothing was signed.';
  if (intent?.asset !== 'native' && intent?.asset !== 'usdc') return 'Name the asset, ETH or USDC. Nothing was signed.';
  if (intent?.amount == null || intent.amount === '' || Number(intent.amount) <= 0) return 'Name the amount. Nothing was signed.';
  return '';
}
