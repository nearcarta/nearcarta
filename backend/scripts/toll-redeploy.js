// Redeploy plan for toll.nearcarta.near. Prints the steps. Does not sign and does not send.
// close() with 1 yocto returns every yocto, storage included, to nearcarta.near.
// The new account keeps path base-1 and chain 8453, so the derived foreign address stays the same.
// Path A: the board records a pass, then the visitor calls cross_after_board. No key is added here.
import { readFileSync } from 'node:fs';

const dep = JSON.parse(readFileSync(new URL('../../shared/deployments/mainnet.json', import.meta.url), 'utf8'));
const toll = dep.toll || {};
const foreign = String(toll.foreign_address || dep.foreign_address || '').toLowerCase();

const DEST = '0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034';
const PRIOR = '0x1cdbf67e974a3b07b2a52ee7c2d3821c8ec7ea0f';
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
  note: 'Run snapshot, then close, then create the same account and deploy the new wasm. No NEAR stays on a deleted account. This script does not send.',
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
      note: 'The balance, including storage stake, returns to nearcarta.near.',
    },
    {
      step: 'create_and_deploy',
      account: toll.contract || 'toll.nearcarta.near',
      wasm: 'contracts/toll target wasm',
      signer: 'nearcarta.near',
      full_access_keys_after: 0,
      function_call_keys_after: 0,
      note: 'No function-call key. The visitor calls cross_after_board. The toll account cannot.',
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
        allow_to: [DEST, PRIOR],
        max_per_tx: '10000000000000',
        budget: '30000000000000',
        max_fee_cap: MAX_FEE,
        verify_chain: 'Base',
        token: null,
        dao: null,
        gate: null,
      },
      note: 'Same account id, path base-1 and chain 8453 keep the derived address. allow_to includes the fixed payout.',
    },
    {
      step: 'set_cross',
      method: 'set_cross',
      args: {
        board: 'board.nearcarta.near',
        pass_fee: '<yocto the owner sets; the UI reads this back>',
        evm_to: DEST,
        foreign_value: FOREIGN_VALUE,
        max_fee_per_gas: MAX_FEE,
        max_priority_fee_per_gas: PRIORITY,
      },
      note: 'The payout is fixed. The visitor does not choose the recipient, the value or the fees. Arbitrum stays off this account.',
    },
    {
      step: 'verify',
      view: 'policy',
      expect: { path: 'base-1', chain_id: 8453, foreign_address: foreign, evm_to: DEST },
    },
    {
      step: 'fund_foreign',
      address: foreign,
      note: 'Tiny ETH for gas on the derived address. This script does not send it.',
    },
    {
      step: 'teardown',
      method: 'close',
      deposit_yocto: '1',
      beneficiary: 'nearcarta.near',
    },
  ],
};
console.log(JSON.stringify(plan, null, 2));
console.log('v7 Path A: the board records the pass, then the visitor calls cross_after_board. The payout is fixed. No key is added to this account.');
