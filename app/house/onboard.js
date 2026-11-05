// Balance and deed reads for the town HUD. Mainnet only.
import { rpcClient, viewFn } from '../../shared/vault/tx.js';
import mainnetDep from '../../shared/deployments/mainnet.json' with { type: 'json' };

const mainRpc = rpcClient([mainnetDep.rpc]);
export const ARENA = mainnetDep.extras.arena.contract;
export const DEED = mainnetDep.extras.house.contract;
export const GUEST_ID = '';

export async function balance(id) { return balanceOn(id, 'mainnet'); }
export async function balanceOn(id) {
  try {
    const a = await mainRpc('query', { request_type: 'view_account', finality: 'optimistic', account_id: id });
    return BigInt(a.amount);
  } catch (e) {
    return /UNKNOWN_ACCOUNT|does not exist/i.test(e?.message || '') ? 0n : null;
  }
}
export const fmt = y => y == null ? '?' : (Number(y / 10n ** 21n) / 1000).toLocaleString('en', { maximumFractionDigits: 2 });

export function injectGuest() {}
export async function deeds() { return []; }
export async function nfts() { return []; }
export async function nftSupply() { return null; }
export async function deedHouses(id) {
  try {
    const held = await viewFn(mainRpc, DEED, 'nft_tokens_for_owner', { account_id: id, limit: 10 });
    return await Promise.all((held || []).map(async t => ({ ...t, purse: await viewFn(mainRpc, DEED, 'house_purse', { token_id: t.token_id }) })));
  } catch { return []; }
}
export async function deedMinted(id) {
  try { return !!(await viewFn(mainRpc, DEED, 'nft_token', { token_id: id })); } catch { return false; }
}
