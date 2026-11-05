// Public explorer links. The product is NEAR mainnet.
export function explorer() {
  return 'https://nearblocks.io';
}
export function txUrl(hash) {
  return hash ? `${explorer()}/txns/${hash}` : '';
}
export function addrUrl(account) {
  return account ? `${explorer()}/address/${account}` : '';
}
