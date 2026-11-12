// Which contract the house deed routes read. Mainnet: deployments `house_deed`, else the city house shop.
// Testnet: deployments `house_deed`, else that network's `house` record (the same house_nft crate).
const MINT = { gas: '100000000000000', deposit_yocto: '20000000000000000000000' };
export function deedRecord(dep, net, mainnetShop) {
  if (dep?.house_deed) return dep.house_deed;
  if (net === 'testnet') return dep?.house?.contract ? { contract: dep.house.contract, mint: MINT } : null;
  return { contract: mainnetShop, mint: MINT };
}
