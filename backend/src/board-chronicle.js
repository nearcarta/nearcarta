// Recorded mainnet board rows. Shop comes from the payee, not a fixed label.
import { MAINNET_DEP } from './config.js';
import { shopOf } from './board-tx.js';

const link = hash => `https://nearblocks.io/txns/${hash}`;

export function mainnetChronicle(owner = '') {
  const board = MAINNET_DEP?.board || {};
  const run = board.visitor_run || {};
  const rules = run.rules?.receivers || [];
  const rows = [];
  const add = (hash, payee, decision, note, signer) => {
    if (!hash) return;
    rows.push({
      hash, url: link(hash), shop: shopOf(payee), payee: payee || null, decision, note,
      signer: signer || null, network: 'mainnet',
    });
  };
  const proofPayee = board.proof?.receiver;
  add(board.txs?.allowed_0?.['001'] || board.txs?.['allowed_0.001'], proofPayee, 'allowed', '0.001 NEAR allowed', board.proof?.visitor);
  add(board.txs?.refused_over_per_action_cap, proofPayee, 'refused', 'over the per-payment cap', board.proof?.visitor);
  add(board.txs?.refused_receiver_not_allowlisted, 'shop-moved-pay-here.near', 'refused', 'payee not on the list', board.proof?.visitor);
  add(run.txs?.open_charter, board.contract, 'opened', 'row opened', run.signer);
  add(run.txs?.propose_allowed_0?.['001'] || run.txs?.['propose_allowed_0.001'], rules[0], 'allowed', '0.001 NEAR allowed', run.signer);
  add(run.txs?.propose_refused_0?.['01_over_per_action_cap'] || run.txs?.['propose_refused_0.01_over_per_action_cap'], rules[0], 'refused', 'over the per-payment cap', run.signer);
  add(run.txs?.propose_allowed_0?.['001_agent_key_no_wallet'] || run.txs?.['propose_allowed_0.001_agent_key_no_wallet'], rules[0], 'allowed', '0.001 NEAR allowed by the agent key', run.signer);
  const want = String(owner || '');
  const txs = want ? rows.filter(r => r.signer === want) : rows;
  return { network: 'mainnet', board: board.contract || null, owner: want || null, count: txs.length, txs };
}
