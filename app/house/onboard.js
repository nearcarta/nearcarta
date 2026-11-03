// New-user helpers for the town HUD and the console: a guest account, free testnet NEAR, and the house deed.
// Testnet only. Keys made here stay in this browser; nothing is sent to our backend.
import { keyFrom, signTx, rpcClient, viewFn } from '../../shared/vault/tx.js';
import { guestWallet, hasGuest } from '../shops/vault/wallet.js';
import { factoriesOf, deedsOn } from './factories.js';
import { rpc as RPC, rpc_fallbacks as RPC_FB, vault, townhall, arena, house_deed } from '../../shared/deployments/testnet.json'; // named: guardhouse test accounts stay out of the bundle
const DEP = { rpc: RPC, vault, townhall, arena };

// fastnear first; 408/429/5xx or a network error rotates to the backups.
export const rpc = rpcClient([DEP.rpc, ...(RPC_FB || [])]);
export const FACTORY = DEP.vault?.factory || DEP.townhall.factory;
/** The current factory first, then every older one, so a charter built before a factory release still counts. */
export const FACTORIES = factoriesOf(DEP.vault, DEP.townhall.factory);
export const ARENA = DEP.arena.contract;
export const GUEST_ID = 'nearcarta-guest';
export const guest = guestWallet(rpc);
export { hasGuest };
const HELPER = 'https://helper.nearprotocol.com/account';
const enc = new TextEncoder();
const wait = ms => new Promise(r => setTimeout(r, ms));

/** Offer the guest wallet to NEAR Connect (call before and after the connector exists). */
export function injectGuest() {
  const fire = () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: guest }));
  window.addEventListener('near-selector-ready', fire); fire();
}

export async function balance(id) {
  // A new implicit account (an email or Google login) is not on chain until its first NEAR arrives: that is 0, not unknown.
  try { const a = await rpc('query', { request_type: 'view_account', finality: 'optimistic', account_id: id }); return BigInt(a.amount); }
  catch (e) { return /UNKNOWN_ACCOUNT|does not exist/i.test(e?.message || '') ? 0n : null; }
}
export const fmt = y => y == null ? '?' : (Number(y / 10n ** 21n) / 1000).toLocaleString('en', { maximumFractionDigits: 2 });

// DeleteAccount action (borsh enum 7 + beneficiary): the helper account's whole balance moves to `to`.
const deleteTo = to => { const s = enc.encode(to), b = new Uint8Array(5 + s.length); b[0] = 7; new DataView(b.buffer).setUint32(1, s.length, true); b.set(s, 5); return b; };

/** Free testnet NEAR for an existing account: the public helper funds a throwaway account with 10 NEAR, which then
 *  deletes itself with `to` as the beneficiary. Returns the tx hash. The throwaway key never leaves this tab. */
export async function faucet(to, note = () => {}) {
  const k = keyFrom(); const tmp = `ncdrip-${Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(36)).join('').slice(0, 9)}.testnet`;
  note('Asking the testnet faucet…');
  const r = await fetch(HELPER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: tmp, newAccountPublicKey: k.publicKey }) });
  if (!r.ok) throw new Error('the testnet faucet said ' + r.status + '; try again in a minute');
  let ak;
  for (let i = 0; i < 20 && !ak; i++) { try { ak = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: tmp, public_key: k.publicKey }); } catch { await wait(1500); } }
  if (!ak) throw new Error('the faucet account did not appear on chain');
  note('Sending the NEAR to ' + to + '…');
  const s = signTx({ key: k, signerId: tmp, receiverId: tmp, nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash, actions: [deleteTo(to)] });
  const res = await rpc('send_tx', { signed_tx_base64: s.base64, wait_until: 'FINAL' });
  if (res?.status?.Failure) throw new Error('faucet transfer failed');
  return s.hash;
}

/** The house deeds: charters this account owns in any charter factory, newest first (the factory registry is the deed today). */
export async function deeds(id) { return deedsOn(FACTORIES, (f, m, a) => viewFn(rpc, f, m, a), id); }
/** NEP-171 Guardian NFTs this account holds on the arena contract. */
export async function nfts(id) { try { return await viewFn(rpc, ARENA, 'nft_tokens_for_owner', { account_id: id, limit: 20 }); } catch { return []; } }
export async function nftSupply() { try { return await viewFn(rpc, ARENA, 'nft_total_supply', {}); } catch { return null; } }

/** House deed v2 (NEP-171): the deed is the house. Deeds this account holds now, each with its purse and cap. */
export const DEED = house_deed?.contract;
export async function deedHouses(id) {
  if (!DEED) return [];
  try {
    const held = await viewFn(rpc, DEED, 'nft_tokens_for_owner', { account_id: id, limit: 10 });
    return await Promise.all(held.map(async t => ({ ...t, purse: await viewFn(rpc, DEED, 'house_purse', { token_id: t.token_id }) })));
  } catch { return []; }
}
export async function deedMinted(id) { try { return !!(await viewFn(rpc, DEED, 'nft_token', { token_id: id })); } catch { return false; } }
