// Browser copy of shared/house/shop.js. The account id lives in shared/deployments/mainnet.json.
// app/build.mjs overwrites dist/house-shop.js from that same file so the city does not keep a second id.
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

const house = MAIN.extras?.house || {};
const shop = house.shop;

export const HOUSE_SHOP = typeof shop === 'string' ? shop : (shop?.account || '');
export const HOUSE_LEGACY = house.legacy || house.contract;
export const HOUSE_OWNER = house.owner || MAIN.root;
export const HOUSE_BOARD = MAIN.board?.contract;
