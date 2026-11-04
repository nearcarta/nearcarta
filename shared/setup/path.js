// What the setup page may say, and what it may do, on each path.
// The default path is a mainnet NEAR account and real NEAR. The free guest is a separate testnet trial.
// publicMainnet (NEXT_PUBLIC_MAINNET=1) hides that guest. A personal charter is created only when
// the mainnet factory in shared/deployments/mainnet.json has status "deployed".
export function setupJourney(trial, opts = {}) {
  const publicMainnet = !!opts.publicMainnet;
  const onTrial = !!trial && !publicMainnet;
  return {
    badge: onTrial ? 'testnet trial' : 'mainnet',
    guestInTiles: false,
    showGuest: !publicMainnet,
    showFaucet: onTrial,
    createCharter: onTrial || !!(publicMainnet && opts.factoryDeployed),
    explorer: onTrial ? 'https://testnet.nearblocks.io' : 'https://nearblocks.io',
    intentsNote: onTrial
      ? 'NEAR Intents swaps on mainnet. This trial is funded by the testnet faucet below.'
      : 'Swap from BTC, ETH, SOL or USDC into NEAR, sent to the address above.',
    fundLead: onTrial
      ? 'This trial account spends testnet NEAR, not real NEAR.'
      : 'Send real NEAR on NEAR mainnet. This path has no faucet.',
  };
}
