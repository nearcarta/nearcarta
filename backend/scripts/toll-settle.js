// Settle a signed Toll / gate record after its Base Sepolia tx is final (testnet only).
// settle is open to any caller: the MPC foreign-tx proof, not the caller, makes the record confirmed.
// Usage: CONTRACT=gate.<owner>.testnet NONCE=1 KEYS=.secrets/toll-visitor/guests.json node backend/scripts/toll-settle.js
import { readFileSync } from 'node:fs';
import { rpcClient, viewFn, keyFrom, signTx, functionCall } from '../../shared/vault/tx.js';

const E = process.env, C = E.CONTRACT, NONCE = Number(E.NONCE);
if (!C || !Number.isInteger(NONCE) || !E.KEYS) throw new Error('CONTRACT, NONCE and KEYS are required');
const rpc = rpcClient(['https://rpc.testnet.near.org', 'https://test.rpc.fastnear.com']);
const evm = async (method, params) => (await (await fetch('https://sepolia.base.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const rec = await viewFn(rpc, C, 'get_tx', { nonce: NONCE });
if (rec.status !== 'signed') { console.log(C, NONCE, 'already', rec.status); process.exit(0); }
const r = await evm('eth_getTransactionReceipt', [rec.tx_hash]);
if (!r) { console.log(C, NONCE, 'was never broadcast to Base Sepolia:', rec.tx_hash); process.exit(2); }
const fin = await evm('eth_getBlockByNumber', ['finalized', false]);
if (parseInt(fin.number) < parseInt(r.blockNumber)) { console.log('not final yet'); process.exit(3); }
const keys = JSON.parse(readFileSync(E.KEYS, 'utf8'));
const g = Object.values(keys).find(v => v?.id && v?.secret) || Object.values(keys).map(v => v?.g).find(v => v?.id && v?.secret);
const key = keyFrom(g.secret);
const ak = await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: g.id, public_key: key.publicKey });
const s = signTx({ key, signerId: g.id, receiverId: C, nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash, actions: [functionCall('settle', { nonce: NONCE, block_hash: r.blockHash }, 150n * 10n ** 12n)] });
const out = await rpc('send_tx', { signed_tx_base64: s.base64, wait_until: 'FINAL' });
const after = await viewFn(rpc, C, 'get_tx', { nonce: NONCE });
console.log(JSON.stringify({ contract: C, nonce: NONCE, base_tx: rec.tx_hash, base_block: parseInt(r.blockNumber), base_status: r.status, settle_tx: s.hash, signer: g.id, failure: out.status.Failure || null, status: after.status, proof_payload_hash: after.proof_payload_hash }));
