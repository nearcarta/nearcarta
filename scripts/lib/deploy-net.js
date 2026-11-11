// Shared preflight for the deploy scripts: which network, which record, and a hard refusal
// when a signer's account suffix does not belong to that network. Every script stays dry by
// default; this module decides what "live" is allowed to mean.
// Docs: https://docs.near.org/tools/cli · https://docs.near.org/smart-contracts/release/deploy
//       https://docs.near.org/protocol/accounts-contracts/account-id (a sub-account belongs to its parent)
import { loadDep, networkFrom, signerMatchesNetwork, NETWORKS } from '../../shared/deployments/net.js';

export { loadDep, networkFrom, signerMatchesNetwork, NETWORKS };

/** True when this run may sign. `--live` alone is not enough: the network must match the signer. */
export const isLive = (argv = process.argv) => argv.includes('--live');

/**
 * Load the deployment record for this run and refuse an impossible pairing.
 * @param {string[]} argv
 * @param {{ signer?: string, keyEnv?: string }} opts  `signer` is the account that would sign,
 *        `keyEnv` the env var its secret is read from (read only to check the suffix, never printed).
 */
export function deployContext(argv = process.argv, { signer = '', keyEnv = '' } = {}) {
  const network = networkFrom();
  const dep = loadDep(network);
  const live = isLive(argv);
  const out = { network, dep, live, root: dep.root, rpc: dep.rpc, signer, keyEnv, refusals: [] };
  if (network === 'testnet' && !String(dep.root || '').endsWith('.testnet')) {
    out.refusals.push('NEAR_NETWORK=testnet but ' + dep.root + ' is not a .testnet account');
  }
  if (network === 'mainnet' && !String(dep.root || '').endsWith('.near')) {
    out.refusals.push('mainnet but ' + dep.root + ' is not a .near account');
  }
  if (signer && !signerMatchesNetwork(signer, network)) {
    // Implicit 64-hex ids are refused outright: their name says nothing about the network, so a
    // wrong pairing could only be caught after a signature existed.
    out.refusals.push(`signer ${signer} does not belong to ${network} (a ${network} signer ends .${network === 'testnet' ? 'testnet' : 'near'})`);
  }
  return out;
}

/** One line the operator can paste, so a dry run always names the exact live command. */
export function liveHint(script, network) {
  const e = network === 'testnet' ? 'NEAR_NETWORK=testnet ' : '';
  return `${e}node scripts/${script} --live --step <step>`;
}

/** A record write helper: the deploy scripts print, they never edit the deployments file. */
export function recordLine(network, key, value) {
  return `shared/deployments/${network}.json ${key} = ${value}`;
}
