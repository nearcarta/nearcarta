// Fresh Toll: one batch from the owner creates <name>.<owner>, funds it, deploys the reproducible
// contracts/artifacts/toll.wasm, calls new() and adds the agent's function-call key (pay, settle).
// The account never gets a full-access key. The contract has no upgrade method, so it is immutable.
// The Base Sepolia address is derived by the MPC from (this account, path); it is checked on-chain here.
// Usage (testnet only): OWNER_KEY_FILE=... AGENT_OUT=... RECIPIENT=0x... NAME=toll node backend/scripts/toll-deploy.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import { keccak_256 } from '@noble/hashes/sha3';
import { base58 } from '@scure/base';
import { cfg } from '../src/config.js';
import { view, accessKeys } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env;
const MPC = 'v1.signer-prod.testnet', PATH_ = 'base-1';
const provider = new JsonRpcProvider({ url: cfg.rpc });
const k = JSON.parse(readFileSync(E.OWNER_KEY_FILE, 'utf8'));
const owner = new Account(k.account_id, provider, KeyPairSigner.fromSecretKey(k.private_key));
const id = `${E.NAME || 'toll'}.${owner.accountId}`;

// Derived key for (id, path) from the MPC contract itself, and the root key it is tweaked from.
const derived = await view(MPC, 'derived_public_key', { path: PATH_, predecessor: id, domain_id: 0 });
const root = await view(MPC, 'public_key', { domain_id: 3 }); // foreign-tx verification domain
const pub = base58.decode(derived.replace('secp256k1:', ''));
const foreign = '0x' + Buffer.from(keccak_256(pub)).subarray(12).toString('hex');
const fxRoot = Buffer.from(base58.decode(root.replace('secp256k1:', ''))).toString('hex');

let agent;
if (existsSync(E.AGENT_OUT)) agent = JSON.parse(readFileSync(E.AGENT_OUT, 'utf8'));
else {
  const kp = KeyPair.fromRandom('ed25519');
  agent = { account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
  writeFileSync(E.AGENT_OUT, JSON.stringify(agent), { mode: 0o600 });
}
const init = { owner: owner.accountId, mpc: MPC, path: PATH_, chain_id: 84532, foreign_address: foreign, fx_root_key: fxRoot,
  allow_to: [E.RECIPIENT.toLowerCase()], max_per_tx: '100000000000000', budget: '300000000000000', max_fee_cap: '5000000000' };
const wasm = readFileSync(new URL('../../contracts/artifacts/toll.wasm', import.meta.url));
const r = await owner.signAndSendTransaction({ receiverId: id, waitUntil: 'FINAL', actions: [
  actions.createAccount(), actions.transfer(25n * 10n ** 23n), actions.deployContract(wasm),
  actions.functionCall('new', init, 100n * 10n ** 12n, 0n),
  actions.addFunctionCallAccessKey(KeyPair.fromString(agent.private_key).getPublicKey(), id, ['pay', 'settle'], 5n * 10n ** 23n),
] });
const fail = r.status?.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
if (fail) { console.error(JSON.stringify(fail)); process.exit(1); }
const keys = (await accessKeys(id)).keys.map(x => ({ public_key: x.public_key, permission: x.access_key.permission }));
console.log(JSON.stringify({ toll: id, owner: owner.accountId, foreign_address: foreign, derived_key: derived, create_deploy_init_tx: r.transaction.hash, access_keys: keys }));
