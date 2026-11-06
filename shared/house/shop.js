// The one house shop account. City, setup, and the deploy script read it from here.
// extras.house.contract and extras.house.legacy are the recorded shop. Its NEAR stays there.
// extras.house.shop.account is the successor. status stays not_deployed until that account exists,
// so a cited-account check does not require it before the create transaction.
import MAIN from '../deployments/mainnet.json' with { type: 'json' };

const house = MAIN.extras?.house || {};

export function houseShopId(record = house) {
  const shop = record?.shop;
  if (typeof shop === 'string') return shop;
  if (shop && typeof shop.account === 'string') return shop.account;
  return '';
}

export const HOUSE_SHOP = houseShopId(house);
export const HOUSE_LEGACY = house.legacy || house.contract;
export const HOUSE_OWNER = house.owner || MAIN.root;
export const HOUSE_BOARD = MAIN.board?.contract;

if (!HOUSE_SHOP || !HOUSE_LEGACY || !HOUSE_OWNER) throw new Error('mainnet.json extras.house shop, legacy and owner are required');

/** Methods a row's set_calls list must name before propose_call_as can reach the shop. */
export const HOUSE_CALLS = [
  { receiver: HOUSE_SHOP, method: 'house_session_check_in' },
  { receiver: HOUSE_SHOP, method: 'house_session_prepare_send' },
];
