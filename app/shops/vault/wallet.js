// Wallet layer for the charter shop: NEAR Connect on mainnet.
import { NearConnector } from '@hot-labs/near-connect';
import { addPrivy } from '../../house/privy.js';

export function hasGuest() { return false; }
export function forgetGuest() {}

export function makeConnector() {
  const connector = new NearConnector({ network: 'mainnet', footerBranding: null, cspNonce: document.querySelector('script[nonce]')?.nonce || undefined });
  addPrivy(connector).catch(() => {});
  return { connector, GUEST_ID: '' };
}

// F26 (film 2026-11-12): a visitor signed in with Google/Privy on /setup has no NEAR Connect wallet in
// this tab, and getConnectedWallet() could stay pending, so the shops never read the session account or
// the row. A wallet that has not answered in time is "no wallet": the saved session account is used.
export const WALLET_ANSWER_MS = 2500;
export async function currentAccount(connector, ms = WALLET_ANSWER_MS) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try {
    const got = await Promise.race([connector.getConnectedWallet().then((w) => w?.accounts?.[0]?.accountId || null, () => null), late]);
    return got || null;
  } catch { return null; } finally { clearTimeout(timer); }
}

export function txHashOf(res) {
  return res?.transaction?.hash || res?.transaction_outcome?.id || (Array.isArray(res) ? txHashOf(res[res.length - 1]) : null);
}
