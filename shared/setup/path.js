// What the setup page may say, and what it may do, on each path.
// The default path is a mainnet NEAR account and real NEAR. The free guest is a separate testnet trial.
export function setupJourney(trial) {
  const onTrial = !!trial;
  return {
    badge: onTrial ? 'testnet trial' : 'mainnet',
    guestInTiles: false,
    showFaucet: onTrial,
    createCharter: onTrial,
    explorer: onTrial ? 'https://testnet.nearblocks.io' : 'https://nearblocks.io',
    intentsNote: onTrial
      ? 'NEAR Intents swaps on mainnet. This trial is funded by the testnet faucet below.'
      : 'Swap from BTC, ETH, SOL or USDC into NEAR, sent to the address above.',
    fundLead: onTrial
      ? 'This trial account spends testnet NEAR, not real NEAR.'
      : 'Send real NEAR on NEAR mainnet. This path has no faucet.',
  };
}
