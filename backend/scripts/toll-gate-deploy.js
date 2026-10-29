// Toll v4 visitor gate: one batch from the owner creates <name>.<owner>, funds it, deploys the reproducible
// contracts/artifacts/toll.v4.wasm and calls new() with a gate. No access key is added, so the account has
// zero keys and nobody can sign as it. Any wallet may call pay_for(charter, action_id): the gate checks on
// chain that the charter is from the factory and that its action paid the toll, then MPC-signs a fixed
// Base Sepolia payout from its own derived address. settle() records the MPC foreign-tx proof.
// Usage (testnet only): OWNER_KEY_FILE=... RECIPIENT=0x... NAME=gate node backend/scripts/toll-gate-deploy.js
import { readFileSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPairSigner, actions } from 'near-api-js';
import { keccak_256 } from '@noble/hashes/sha3';
import { base58 } from '@scure/base';
import { cfg } from '../src/config.js';
import { view, accessKeys } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env;
const MPC = 'v1.signer-prod.testnet', PATH_ = E.GATE_PATH || 'gate-1';
const provider = new JsonRpcProvider({ url: cfg.rpc });
const k = JSON.parse(readFileSync(E.OWNER_KEY_FILE, 'utf8'));
const owner = new Account(k.account_id, provider, KeyPairSigner.fromSecretKey(k.private_key));
const id = `${E.NAME || 'gate'}.${owner.accountId}`;
const derived = await view(MPC, 'derived_public_key', { path: PATH_, predecessor: id, domain_id: 0 });
const root = await view(MPC, 'public_key', { domain_id: 3 });
const foreign = '0x' + Buffer.from(keccak_256(base58.decode(derived.replace('secp256k1:', '')))).subarray(12).toString('hex');
const fxRoot = Buffer.from(base58.decode(root.replace('secp256k1:', ''))).toString('hex');
const to = E.RECIPIENT.toLowerCase();
const gate = { factory: E.FACTORY || 'nccharters-53681.testnet', payee: E.PAYEE || 'cafe.ncpub-17102.testnet',
  fee: E.FEE || '10000000000000000000000', memo: 'toll:base-sepolia', evm_to: to, evm_value: E.EVM_VALUE || '100000000000',
  max_fee_per_gas: '100000000', max_priority_fee_per_gas: '1000000' };
const init = { owner: owner.accountId, mpc: MPC, path: PATH_, chain_id: 84532, foreign_address: foreign, fx_root_key: fxRoot,
  allow_to: [to], max_per_tx: gate.evm_value, budget: E.BUDGET || '30000000000000', max_fee_cap: '100000000', verify_chain: 'Base', gate };
const wasm = readFileSync(new URL('../../contracts/artifacts/toll.v4.wasm', import.meta.url));
const r = await owner.signAndSendTransaction({ receiverId: id, waitUntil: 'FINAL', actions: [
  actions.createAccount(), actions.transfer(3n * 10n ** 24n), actions.deployContract(wasm),
  actions.functionCall('new', init, 100n * 10n ** 12n, 0n),
] });
const fail = r.status?.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
if (fail) { console.error(JSON.stringify(fail)); process.exit(1); }
const keys = (await accessKeys(id)).keys.length;
console.log(JSON.stringify({ gate: id, owner: owner.accountId, path: PATH_, foreign_address: foreign, derived_key: derived, policy: gate, create_deploy_init_tx: r.transaction.hash, access_keys: keys }));
