// The one house shop account. City, setup, and the deploy script read it from here.
// extras.house.shop is recreated after close. extras.house.fallback is unused unless that recreate cannot keep the name.
// The next wasm hash sits on a not-deployed record so a cited-account check does not require it on chain yet.
import MAIN from '../deployments/mainnet.json' with { type: 'json' };

const house = MAIN.extras?.house || {};

export function houseShopId(record = house) {
  const shop = record?.shop;
  if (typeof shop === 'string') return shop;
  if (shop && typeof shop.account === 'string') return shop.account;
  return '';
}

export function houseFallbackId(record = house) {
  const fallback = record?.fallback;
  if (typeof fallback === 'string') return fallback;
  if (fallback && typeof fallback.account === 'string') return fallback.account;
  return '';
}

export const HOUSE_SHOP = houseShopId(house);
export const HOUSE_FALLBACK = houseFallbackId(house);
export const HOUSE_LEGACY = house.legacy || house.contract;
export const HOUSE_OWNER = house.owner || MAIN.root;
export const HOUSE_BOARD = MAIN.board?.contract;
export const HOUSE_WASM_PATH = house.next?.wasm || '';
export const HOUSE_WASM_SHA256 = house.next?.sha256 || '';

if (!HOUSE_SHOP || !HOUSE_LEGACY || !HOUSE_OWNER) throw new Error('mainnet.json extras.house shop, legacy and owner are required');

/** Methods a row's set_calls list must name before propose_call_as can reach the shop. */
export const HOUSE_CALLS = [
  { receiver: HOUSE_SHOP, method: 'house_session_check_in' },
  { receiver: HOUSE_SHOP, method: 'house_session_prepare_send' },
];
