// Privy (email / Google login): the app id and client id are public client ids read from the build env.
// The Privy app id is a public id (it ships in every page); the Vercel build has no env access, so it lives here.
export const PRIVY_ID = process.env.VITE_PRIVY_APP_ID || process.env.PRIVY_APP_ID || 'cmw16bdnw01op0gjql0x3o1of';
// The web client id is public (it ships in every page). The env can override it with another client- id.
const WEB_CLIENT = 'client-WY6fYdWNytEzqeEFYuyvUMbZP8f59hsNtvZXQnupu9Rtm';
const envClient = process.env.VITE_PRIVY_APP_CLIENT_ID || process.env.PRIVY_CLIENT_ID || '';
const rawClient = envClient.startsWith('client-') ? envClient : WEB_CLIENT;
// A Privy client id starts with "client-". Anything else (an app secret pasted in the wrong field) must never reach a browser bundle.
if (envClient && !envClient.startsWith('client-')) console.warn('Privy client id ignored: it is not a client id (does not start with "client-"). the public web client id is used.');
export const PRIVY_CLIENT = rawClient.startsWith('client-') ? rawClient : '';
const NEAR_NET = process.env.NEAR_NET === 'mainnet' ? 'mainnet' : 'testnet';
export const walletDefine = { __PRIVY_ON__: String(!!PRIVY_ID), __NEAR_NET__: JSON.stringify(NEAR_NET) };
