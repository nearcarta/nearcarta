// What the setup page may say, and what it may do.
// The only path is a mainnet NEAR account and real NEAR.
// A personal charter row is opened only when the mainnet board is deployed.
export function setupJourney(_trial, opts = {}) {
  const boardDeployed = !!(opts.boardDeployed || opts.publicMainnet && opts.boardDeployed);
  return {
    badge: 'mainnet',
    guestInTiles: false,
    showGuest: false,
    showFaucet: false,
    createCharter: !!(opts.publicMainnet && opts.boardDeployed),
    explorer: 'https://nearblocks.io',
    intentsNote: 'Swap from BTC, ETH, SOL or USDC into NEAR, sent to the address above.',
    fundLead: 'Send real NEAR on NEAR mainnet. This path has no faucet.',
    boardDeployed,
  };
}
