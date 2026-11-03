// Creates the named root (e.g. nearcarta.near) from an implicit account through the network registrar
// (`near` on mainnet, `testnet` on testnet): create_account { new_account_id, new_public_key } with DEPOSIT attached.
// The deposit is not a fee: it becomes the new account's balance (the name itself costs only its ~182 B of storage).
// Usage: NET=testnet|mainnet FROM_KEY=<json> [FROM_ID=<id>] NAME=<name>.<near|testnet> DEPOSIT=<NEAR> [DRY_RUN=1] node backend/scripts/create-named-root.js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';
const E = process.env, NET = E.NET;
const C = { testnet: { rpc: 'https://rpc.testnet.fastnear.com', reg: 'testnet' }, mainnet: { rpc: 'https://rpc.mainnet.fastnear.com', reg: 'near' } }[NET];
if (!C || !E.NAME || !E.NAME.endsWith(`.${C.reg}`) || E.NAME.split('.').length !== 2) { console.error('NET and NAME=<x>.' + (C?.reg || 'near|testnet') + ' required'); process.exit(2); }
const rq = async p => { const r = await (await fetch(C.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: p }) })).json(); if (r.error) throw new Error(r.error.cause?.name || JSON.stringify(r.error)); return r.result; };
const taken = await rq({ request_type: 'view_account', finality: 'final', account_id: E.NAME }).then(() => true).catch(e => e.message === 'UNKNOWN_ACCOUNT' ? false : Promise.reject(e));
const FK = JSON.parse(readFileSync(E.FROM_KEY, 'utf8')); const FROM = E.FROM_ID || FK.account_id || FK.implicit_account_id;
const from = await rq({ request_type: 'view_account', finality: 'final', account_id: FROM });
const dep = BigInt(Math.round(Number(E.DEPOSIT) * 1e6)) * 10n ** 18n;
console.log(JSON.stringify({ name: E.NAME, available: !taken, from: FROM, from_balance_near: Number(BigInt(from.amount) / 10n ** 18n) / 1e6, deposit_near: Number(E.DEPOSIT), registrar: C.reg }));
if (taken) { console.error('name taken'); process.exit(1); }
if (E.DRY_RUN === '1') process.exit(0);
const dir = `${homedir()}/.near-credentials/${NET}`; mkdirSync(dir, { recursive: true });
const kf = `${dir}/${E.NAME}.json`;
let k; if (existsSync(kf)) k = JSON.parse(readFileSync(kf, 'utf8'));
else { const kp = KeyPair.fromRandom('ed25519'); k = { account_id: E.NAME, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }; writeFileSync(kf, JSON.stringify(k), { mode: 0o600 }); }
const acc = new Account(FROM, new JsonRpcProvider({ url: C.rpc }), KeyPairSigner.fromSecretKey(FK.private_key));
const r = await acc.signAndSendTransaction({ receiverId: C.reg, actions: [A.functionCall('create_account', { new_account_id: E.NAME, new_public_key: k.public_key }, 30n * 10n ** 12n, dep)], waitUntil: 'FINAL', throwOnFailure: false });
const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
const now = await rq({ request_type: 'view_account', finality: 'final', account_id: E.NAME }).catch(() => null);
console.log(JSON.stringify({ tx: r.transaction.hash, ok: !bad && !!now, ret: r.status.SuccessValue ? Buffer.from(r.status.SuccessValue, 'base64').toString() : undefined, error: bad ? JSON.stringify(bad).slice(0, 300) : undefined, name_balance_near: now ? Number(BigInt(now.amount) / 10n ** 18n) / 1e6 : null, key_file: kf }));
