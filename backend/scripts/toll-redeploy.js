// Redeploy plan for toll.nearcarta.near. Prints the steps. Does not sign and does not send.
// close() with 1 yocto returns every yocto, storage included, to nearcarta.near.
// The new account keeps path base-1 so the derived foreign address stays the same.
import { readFileSync } from 'node:fs';

const dep = JSON.parse(readFileSync(new URL('../../shared/deployments/mainnet.json', import.meta.url), 'utf8'));
const toll = dep.toll || {};
const foreign = String(toll.foreign_address || '').toLowerCase();

const plan = {
  sends: false,
  network: 'mainnet',
  account: toll.contract || 'toll.nearcarta.near',
  owner: toll.owner || 'nearcarta.near',
  note: 'Run snapshot, then close, then create the account again and deploy the new wasm. No NEAR stays on a deleted account.',
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
    },
    {
      step: 'new',
      method: 'new',
      args: {
        owner: 'nearcarta.near',
        mpc: 'v1.signer',
        path: toll.path || 'base-1',
        chain_id: 8453,
        foreign_address: foreign,
        allow_to: [],
        verify_chain: 'Base',
        note: 'No recipient list. Visitors name the address. The recorded foreign_address is only the old shared path. Same path keeps that address for the old records.',
      },
    },
    {
      step: 'set_policy',
      method: 'set_policy',
      args: {
        board: 'board.nearcarta.near',
        fee: '<yocto NEAR the owner sets; the UI reads this back>',
        chains: [
          { name: 'Base', chain_id: 8453, max_per_tx: '10000000000000', max_fee_cap: '5000000000', usdc: null },
          { name: 'Arbitrum', chain_id: 42161, max_per_tx: '10000000000000', max_fee_cap: '5000000000', usdc: null },
        ],
        split: [],
      },
      note: 'The visitor names the recipient. max_per_tx is a sanity cap in wei. The row cap is the real limit. cross needs the board to forward the row owner.',
    },
    { step: 'verify', view: 'policy', expect: { path: 'base-1', chain_id: 8453, foreign_address: foreign } },
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
