// One install for toll.nearcarta.near. Prints the steps. Does not sign and does not send.
// The live wasm has no upgrade method, so this install is close, then the same account again.
// After it, the owner calls upgrade and migrate. A new visitor does not need another deploy.
// close() with 1 yocto returns every yocto, storage included, to nearcarta.near.
// It refuses while a service deposit is held or a crossing is still open.
// The recovered balance pays the new account. This plan does not ask for a top-up.
// Path base-1 stays on the account so the old derived address is unchanged.
// A visitor crossing uses row:{owner}:base and does not spend from that shared address.
import { readFileSync } from 'node:fs';

const dep = JSON.parse(readFileSync(new URL('../../shared/deployments/mainnet.json', import.meta.url), 'utf8'));
const toll = dep.toll || {};
const foreign = String(toll.foreign_address || dep.foreign_address || '').toLowerCase();

const MAX_FEE = '5000000000';

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
      note: 'No function-call key. The board opens cross. The row owner calls sign_cross. No keeper key.',
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
      note: 'Same account id. path base-1 is the old shared derivation, not a visitor wallet. allow_to is empty.',
    },
    {
      step: 'set_price',
      method: 'set_price',
      args: {
        board: 'board.nearcarta.near',
        fee: '<yocto the owner sets; the UI reads this back>',
        cost: '<yocto, at most the fee>',
        splits: [],
        paused: false,
        usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        max_token: '<token units the owner sets>',
        hold_ns: '0',
      },
      note: 'Circle USDC on Base is the token contract, not a recipient. The owner can replace it. Splits stay empty until a contributor is configured. No visitor address is stored.',
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
console.log('Visitor path is row:{owner}:base. The shared address is not a visitor wallet. This script does not send.');
