// Email / Google login through Privy, offered as one more wallet in NEAR Connect.
// The executor runs in NEAR Connect's sandbox and opens /sign (our own page) for login and signing.
// Pinned to an immutable commit, as the NEAR docs require.
const EXECUTOR = 'https://raw.githubusercontent.com/beneviolabs/privy-near-connect/3d56b782669d242a1ea432921e291abc26b4ebc7/executor.js';
// esbuild replaces __PRIVY_ON__ with true only when the build had both Privy values.
const ON = typeof __PRIVY_ON__ !== 'undefined' && __PRIVY_ON__;
export const NEAR_NET = typeof __NEAR_NET__ !== 'undefined' ? __NEAR_NET__ : 'mainnet';

export function privyManifest(origin = location.origin) {
  return {
    id: 'nearcarta-privy', name: 'Email or Google', icon: origin + '/favicon.ico',
    description: 'Log in with email or Google; a NEAR wallet is made for you', website: origin, version: '1.0.0',
    executor: EXECUTOR, type: 'sandbox', platform: { web: origin },
    features: { signMessage: true, signInWithoutAddKey: true, signInAndSignMessage: true, signInWithFunctionCallKey: true,
      signAndSendTransaction: true, signAndSendTransactions: true, mainnet: true },
    permissions: { isPrivyConnect: true, storage: true, allowsOpen: [origin] },
    metadata: { signPageURL: origin + '/sign' },
  };
}

export function addPrivy(connector) {
  if (!ON) return Promise.resolve(false);
  return connector.whenManifestLoaded.then(() => connector.registerWallet(privyManifest())).then(() => true);
}
