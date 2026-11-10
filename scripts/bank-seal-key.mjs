// Adds the Bank seal key to keeper-bank: a function-call key that can call only board.anchor, with a small
// allowance. The new key is saved chmod 600 BEFORE it is added. Dry run unless --send. Never prints a key.
import { writeFileSync, readFileSync, existsSync, chmodSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
const { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions: A } = await import('near-api-js');
const ACCT = 'keeper-bank.nearcarta.near', BOARD = 'board.nearcarta.near';
const ALLOW = 12n * 10n ** 21n; // 0.012 NEAR of gas, about 33 seals
const FILE = `${homedir()}/.near-credentials/mainnet/keeper-bank-seal.json`;
const p = new JsonRpcProvider({ url: 'https://rpc.mainnet.fastnear.com' });
const bal = async () => BigInt((await p.viewAccount({ accountId: ACCT, blockQuery: { finality: 'final' } })).amount);
let kp;
if (existsSync(FILE)) { kp = KeyPair.fromString(JSON.parse(readFileSync(FILE, 'utf8')).private_key); }
else { kp = KeyPair.fromRandom('ed25519'); writeFileSync(FILE, JSON.stringify({ account_id: ACCT, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 }); chmodSync(FILE, 0o600); }
if ((statSync(FILE).mode & 0o777) !== 0o600) throw new Error('key file not 600');
const pub = kp.getPublicKey().toString();
const have = await p.viewAccessKey({ accountId: ACCT, publicKey: pub, blockQuery: { finality: 'final' } }).then(() => true, () => false);
const before = await bal();
console.log(JSON.stringify({ public_key: pub, already_on_chain: have, balance_near: Number(before / 10n ** 18n) / 1e6, allowance_near: 0.012, expect_cost_near: '~0.0001 gas + ~0.0004 key storage (locked)' }));
if (have || !process.argv.includes('--send')) process.exit(0);
const key = JSON.parse(readFileSync(`${homedir()}/.near-credentials/mainnet/${ACCT}.json`, 'utf8')).private_key;
const a = new Account(ACCT, p, KeyPairSigner.fromSecretKey(key));
const r = await a.signAndSendTransaction({ receiverId: ACCT, actions: [A.addFunctionCallAccessKey(kp.getPublicKey(), BOARD, ['anchor'], ALLOW)], waitUntil: 'FINAL', throwOnFailure: false });
const after = await bal();
console.log(JSON.stringify({ hash: r.transaction.hash, ok: !r.status?.Failure, failure: r.status?.Failure || null, spent_near: Number((before - after) / 10n ** 18n) / 1e6 }));
