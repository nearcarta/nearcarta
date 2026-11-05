// WalletConnect sign client, loaded only when a WalletConnect wallet is picked (kept out of the main bundle).
import SignClient from '@walletconnect/sign-client';
export const init = projectId => SignClient.init({ projectId, metadata: { name: 'Nearcarta', description: 'Charters that keep an AI agent to its rules on NEAR mainnet.', url: location.origin, icons: [location.origin + '/favicon.svg'] } });
