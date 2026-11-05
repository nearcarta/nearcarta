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

export async function currentAccount(connector) {
  try { const { accounts } = await connector.getConnectedWallet(); return accounts?.[0]?.accountId || null; } catch { return null; }
}

export function txHashOf(res) {
  return res?.transaction?.hash || res?.transaction_outcome?.id || (Array.isArray(res) ? txHashOf(res[res.length - 1]) : null);
}
