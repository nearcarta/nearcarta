// The house deed is a NEP-171 token. The current holder is the only account that may spend the purse.
// These hashes are the recorded mainnet payments. This module does not sign.

export const DEED = {
  contract: 'house.nearcarta.near',
  standard: 'nep171',
  name: 'Nearcarta House deeds',
  symbol: 'HOUSE',
  description: 'Whoever holds this deed controls the house purse. A transfer moves that control.',
  mint: 'FqYcLtmLb7WM9vo83iMNyfSMiMnifSMLQJPJHwBzLtnu',
  allow: '83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26',
  refuse: '3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1',
};

export function txUrl(hash) {
  return hash ? `https://nearblocks.io/txns/${hash}` : '';
}

/** After a transfer, only the new holder may call house_pay. */
export function controlAfterMove({ holder, payer }) {
  const allowed = !!holder && holder === payer;
  return {
    allowed,
    holder: holder || '',
    payer: payer || '',
    reason: allowed
      ? 'The current holder may spend from this house.'
      : 'Only the current holder may spend. A previous holder is refused.',
  };
}

export function metadataView(extra = {}) {
  return {
    contract: DEED.contract,
    standard: extra.standard || DEED.standard,
    name: extra.name || DEED.name,
    symbol: extra.symbol || DEED.symbol,
    description: extra.description || DEED.description,
    copies: extra.copies ?? null,
  };
}
