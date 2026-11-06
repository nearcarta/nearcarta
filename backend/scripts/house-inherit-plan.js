// Print the house inheritance plan. This process does not sign and does not spend.
// A function-call key cannot attach NEAR, and the live house account has no full-access key,
// so the new methods cannot be pushed onto house.nearcarta.near.
// https://docs.near.org/protocol/accounts-contracts/access-keys
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
  why: 'house.nearcarta.near has no access key, so this wasm cannot replace it',
  teardown: 'close() with 1 yocto, only when house_held is 0, refunds the owner',
  methods: ['house_set_line', 'house_check_in', 'house_cancel_release', 'house_guardian_approve', 'house_release'],
  signed: false,
};
if (process.env.HOUSE_DEPLOY || process.env.HOUSE_SIGN) {
  console.log(JSON.stringify({ ...plan, refused: true }));
  process.exit(2);
}
console.log(JSON.stringify(plan));
