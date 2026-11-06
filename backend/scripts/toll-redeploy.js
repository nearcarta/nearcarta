// One install for toll.nearcarta.near. Prints the steps. Does not sign and does not send.
// The live wasm has no upgrade method, so this install is close, then the same account again.
// After it, the owner calls upgrade and migrate. A new visitor does not need another deploy.
// close() with 1 yocto returns every yocto, storage included, to nearcarta.near.
// Path base-1 and chain 8453 keep the derived foreign address. Init stores no recipient.
import { readFileSync } from 'node:fs';

const dep = JSON.parse(readFileSync(new URL('../../shared/deployments/mainnet.json', import.meta.url), 'utf8'));
const toll = dep.toll || {};
const foreign = String(toll.foreign_address || dep.foreign_address || '').toLowerCase();

const FOREIGN_VALUE = '1000000000000';
const MAX_FEE = '5000000000';
const PRIORITY = '1000000000';

const plan = {
  sends: false,
  network: 'mainnet',
  account: toll.contract || 'toll.nearcarta.near',
  owner: toll.owner || 'nearcarta.near',
  path: 'base-1',
  chain_id: 8453,
  foreign_address: foreign,
  note: 'This is the last close. The new wasm is upgradeable. No recipient is stored at init. This script does not send.',
  steps: [
    {
      step: 'snapshot',
      views: ['policy', 'get_tx'],
      nonces: '0 .. policy.next_nonce',
      save: 'shared/deployments/toll-snapshot.json',
    },
    {
      step: 'close',
      method: 'close',
      args: {},
      deposit_yocto: '1',
      signer: 'nearcarta.near',
      beneficiary: 'nearcarta.near',
      note: 'Only because the live wasm cannot upgrade itself. The balance, including storage stake, returns to nearcarta.near.',
    },
    {
      step: 'create_and_deploy',
      account: toll.contract || 'toll.nearcarta.near',
      wasm: 'contracts/toll target wasm',
      signer: 'nearcarta.near',
      full_access_keys_after: 0,
      function_call_keys_after: 0,
      note: 'No function-call key. The visitor calls cross_after_board and names the recipient.',
    },
    {
      step: 'new',
      method: 'new',
      args: {
        owner: 'nearcarta.near',
        mpc: 'v1.signer',
        path: 'base-1',
        chain_id: 8453,
        foreign_address: foreign,
        fx_root_key: dep.fx_root_key || '',
        allow_to: [],
        max_per_tx: '10000000000000',
        budget: '30000000000000',
        max_fee_cap: MAX_FEE,
        verify_chain: 'Base',
        token: null,
        dao: null,
        gate: null,
      },
      note: 'Same account id, path base-1 and chain 8453 keep the derived address. allow_to is empty. A visitor is not a new deploy.',
    },
    {
      step: 'set_cross',
      method: 'set_cross',
      args: {
        board: 'board.nearcarta.near',
        pass_fee: '<yocto the owner sets; the UI reads this back>',
        foreign_value: FOREIGN_VALUE,
        max_fee_per_gas: MAX_FEE,
        max_priority_fee_per_gas: PRIORITY,
      },
      note: 'The value and the fees are caps. The recipient is an argument on cross_after_board.',
    },
    {
      step: 'verify',
      view: 'policy',
      expect: { path: 'base-1', chain_id: 8453, foreign_address: foreign, allow_to: [], recipients: 'visitor' },
    },
    {
      step: 'later',
      method: 'upgrade',
      then: 'migrate',
      signer: 'nearcarta.near',
      note: 'A later wasm change is upgrade, then migrate. It does not close the account and it is not once per visitor.',
    },
  ],
};
console.log(JSON.stringify(plan, null, 2));
console.log('v7 Path A: the visitor names the recipient. Init stores none. The owner upgrades later with migrate.');
