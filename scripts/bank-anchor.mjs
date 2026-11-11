// One Mist Bank anchor on the live board: the bank keeper commits to a profit figure without
// showing it. The board hashes salt||digest and logs only the commitment (contracts/charter_board/src/v2.rs anchor).
// The preimage (amount + nonce) and salt go to a chmod-600 file so the amount can be revealed later.
//   node scripts/bank-anchor.mjs --amount 0.001710 [--send]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
const ACCT = 'keeper-bank.nearcarta.near', BOARD = 'board.nearcarta.near', RPC = 'https://rpc.mainnet.fastnear.com';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const amount = arg('--amount'), send = process.argv.includes('--send');
const OUT = '/workspace/near/bank/anchor-secret.json';
if (!/^\d+\.\d+$/.test(amount || '')) throw new Error('--amount NEAR');
if (existsSync(OUT)) throw new Error(`${OUT} exists: an anchor was already prepared; check it on chain before sending again`);
const nonce = randomBytes(16).toString('hex'), salt = randomBytes(12).toString('hex');
const preimage = `mist-bank:profit:${amount}:NEAR:${nonce}`;
const digest = createHash('sha256').update(preimage).digest('hex');
const commitment = createHash('sha256').update(Buffer.concat([Buffer.from(salt), Buffer.from(digest, 'hex')])).digest('hex');
const provider = new JsonRpcProvider({ url: RPC });
const bal = async () => BigInt((await provider.viewAccount({ accountId: ACCT, blockQuery: { finality: 'final' } })).amount);
const before = await bal();
console.log(JSON.stringify({ acct: ACCT, method: 'anchor', kind: 'bank_profit', commitment, prepaid_gas_tgas: 10, max_cost_near: 0.0011, balance_near: Number(before / 10n ** 18n) / 1e6 }));
if (!send) process.exit(0);
writeFileSync(OUT, JSON.stringify({ preimage, digest, salt, commitment }), { mode: 0o600 });
const key = JSON.parse(readFileSync(`${homedir()}/.near-credentials/mainnet/${ACCT}.json`, 'utf8')).private_key;
const account = new Account(ACCT, provider, KeyPairSigner.fromSecretKey(key));
const r = await account.signAndSendTransaction({ receiverId: BOARD, actions: [A.functionCall('anchor', { kind: 'bank_profit', digest, salt }, 10_000_000_000_000n, 0n)], waitUntil: 'FINAL', throwOnFailure: false });
const hash = r.transaction.hash, fail = r.status?.Failure;
const logs = r.receipts_outcome.flatMap((o) => o.outcome.logs);
const burnt = [r.transaction_outcome, ...r.receipts_outcome].reduce((s, o) => s + BigInt(o.outcome.tokens_burnt), 0n);
await new Promise((z) => setTimeout(z, 3000));
const after = await bal();
const rec = { hash, ok: !fail, fail: fail || null, logs, burnt_near: Number(burnt / 10n ** 18n) / 1e6, spent_near: Number((before - after) / 10n ** 18n) / 1e6, commitment, at: new Date().toISOString() };
writeFileSync('/workspace/near/bank/anchor-tx.json', JSON.stringify(rec, null, 2));
console.log(JSON.stringify(rec));
