// Print the house successor plan. This process does not sign and does not spend.
// The live house account has no access key, so this wasm cannot replace it.
// Refund the purse to the current holder first. close() refuses while a purse
// or a funded foreign vault still holds value. Then the owner closes and a new
// account receives the v3 code.
// https://docs.near.org/protocol/accounts-contracts/access-keys
// https://docs.near.org/smart-contracts/release/upgrade#migrating-the-state
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainnet = JSON.parse(readFileSync(join(root, 'shared/deployments/mainnet.json'), 'utf8'));
const house = mainnet.extras?.house || {};
const plan = {
  contract: house.contract,
  owner: house.owner,
  full_access_keys: house.full_access_keys,
  upgrade: false,
  successor: true,
  why: 'house.nearcarta.near has no access key, and house_line is not on the live code, so this wasm cannot replace it',
  refund: 'house_withdraw pays the purse only to the current holder',
  teardown: 'close() with 1 yocto, only when house_held is 0 and no foreign vault is marked funded, refunds the owner',
  foreign: 'A funded vault blocks close until the deployer records an evacuation. Teardown does not destroy control of a funded foreign path.',
  methods: [
    'house_set_line', 'house_check_in', 'house_cancel_release', 'house_guardian_approve', 'house_release',
    'house_session_mint', 'house_session_check_in', 'house_session_prepare_send', 'house_withdraw', 'upgrade', 'migrate',
  ],
  live_broadcast: false,
  signed: false,
};
if (process.env.HOUSE_DEPLOY || process.env.HOUSE_SIGN) {
  console.log(JSON.stringify({ ...plan, refused: true }));
  process.exit(2);
}
console.log(JSON.stringify(plan));
