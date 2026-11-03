// Privy (email / Google login): the app id and client id are public client ids read from the build env.
export const PRIVY_ID = process.env.VITE_PRIVY_APP_ID || process.env.PRIVY_APP_ID || '';
const rawClient = process.env.VITE_PRIVY_APP_CLIENT_ID || process.env.PRIVY_CLIENT_ID || '';
// A Privy client id starts with "client-". Anything else (an app secret pasted in the wrong field) must never reach a browser bundle.
if (rawClient && !rawClient.startsWith('client-')) console.warn('Privy client id ignored: it is not a client id (does not start with "client-"). /sign is built without it.');
export const PRIVY_CLIENT = rawClient.startsWith('client-') ? rawClient : '';
const NEAR_NET = process.env.NEAR_NET === 'mainnet' ? 'mainnet' : 'testnet';
export const walletDefine = { __PRIVY_ON__: String(!!PRIVY_ID), __NEAR_NET__: JSON.stringify(NEAR_NET) };
