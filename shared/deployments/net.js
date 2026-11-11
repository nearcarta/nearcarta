// One place that answers "which network is this process on" for scripts and the API.
// Addresses always come from shared/deployments/<network>.json, never from this file.
// A signer must belong to the network it signs for, so a testnet run can never be
// pointed at a mainnet key by a typo in an env var.
// Docs: https://docs.near.org/tools/cli · https://docs.near.org/protocol/accounts-contracts/account-id
//       https://docs.near.org/smart-contracts/release/deploy
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const NETWORKS = ['mainnet', 'testnet'];

/** `NEAR_NETWORK=testnet` selects the testnet record; anything else stays mainnet. */
export function networkFrom(env = process.env) {
  return String(env.NEAR_NETWORK || '').trim().toLowerCase() === 'testnet' ? 'testnet' : 'mainnet';
}

export const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const IMPLICIT = /^[0-9a-f]{64}$/;

export function accountOk(id) {
  const s = String(id || '');
  return IMPLICIT.test(s) || ACCOUNT.test(s);
}

/** The suffix a signer must carry on each network. Mainnet accounts end `.near`. */
export function signerMatchesNetwork(signer, network) {
  const id = String(signer || '').trim();
  if (!accountOk(id)) return false;
  if (IMPLICIT.test(id)) return false; // an implicit id says nothing about the network: refuse it
  return network === 'testnet' ? id.endsWith('.testnet') : id.endsWith('.near');
}

/** The deployment record for `network`, or the file named by `DEPLOYMENTS_FILE`. */
export function loadDep(network = networkFrom(), file = process.env.DEPLOYMENTS_FILE) {
  const path = file || join(here, `${network}.json`);
  const base = JSON.parse(readFileSync(path, 'utf8'));
  return { ...base, network: base.network || network };
}

export const depPath = (network = networkFrom()) => join(here, `${network}.json`);

/** The explorer for a network. Recorded mainnet proofs keep mainnet even on a testnet page. */
export function explorerOf(network) {
  return network === 'testnet' ? 'https://testnet.nearblocks.io' : 'https://nearblocks.io';
}
