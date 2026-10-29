// Gas for the Toll gate's derived address, with no faucet: the existing Toll (toll.<owner>.testnet) MPC-signs
// a payout from its funded derived address to the allowlisted test EOA, then that EOA forwards the coins to the
// gate's derived address. Base Sepolia only; prints tx hashes, never keys.
// Usage: TOLL=... AGENT_KEY_FILE=... EVM_KEY_FILE=... GATE_EVM=0x... VALUE=<wei> node backend/scripts/toll-gate-fund.js
import { readFileSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPairSigner, actions } from 'near-api-js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3';
import { cfg } from '../src/config.js';
import { view } from '../src/near.js';

const E = process.env, BASE = 'https://sepolia.base.org', CHAIN = 84532n;
const rpc = async (method, params) => { const j = await (await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); if (j.error) throw new Error(method + ': ' + j.error.message); return j.result; };
const receipt = async h => { for (let i = 0; i < 60; i++) { const r = await rpc('eth_getTransactionReceipt', [h]); if (r) return r; await new Promise(s => setTimeout(s, 2000)); } throw new Error('no receipt ' + h); };
const value = BigInt(E.VALUE || '50000000000000');

// 1. Existing Toll pays the allowlisted EOA from its derived address.
const k = JSON.parse(readFileSync(E.AGENT_KEY_FILE, 'utf8'));
const agent = new Account(k.account_id, new JsonRpcProvider({ url: cfg.rpc }), KeyPairSigner.fromSecretKey(k.private_key));
const key = JSON.parse(readFileSync(E.EVM_KEY_FILE, 'utf8'));
const r = await agent.signAndSendTransaction({ receiverId: E.TOLL, waitUntil: 'FINAL', throwOnFailure: false, actions: [actions.functionCall('pay',
  { to: key.address.toLowerCase(), value: value.toString(), max_fee_per_gas: '100000000', max_priority_fee_per_gas: '1000000', gas_limit: 21000 }, 200n * 10n ** 12n, 0n)] });
const ret = JSON.parse(Buffer.from(r.status.SuccessValue || '', 'base64').toString() || 'null');
if (!ret?.nonce && ret?.nonce !== 0) { console.error('pay failed', JSON.stringify(r.status).slice(0, 300)); process.exit(1); }
const rec = await view(E.TOLL, 'get_tx', { nonce: ret.nonce });
const h1 = await rpc('eth_sendRawTransaction', [rec.raw_signed]);
console.log(JSON.stringify({ toll_pay_near_tx: r.transaction.hash, toll_nonce: ret.nonce, base_tx: h1, block: parseInt((await receipt(h1)).blockNumber) }));

// 2. The EOA forwards the same amount to the gate's derived address (EIP-1559, signed locally).
const enc = x => { // minimal RLP
  if (Array.isArray(x)) { const b = Buffer.concat(x.map(enc)); return Buffer.concat([len(b.length, 0xc0), b]); }
  const b = typeof x === 'bigint' ? (x === 0n ? Buffer.alloc(0) : Buffer.from(x.toString(16).padStart(Math.ceil(x.toString(16).length / 2) * 2, '0'), 'hex')) : Buffer.from(x.replace(/^0x/, ''), 'hex');
  return b.length === 1 && b[0] < 0x80 ? b : Buffer.concat([len(b.length, 0x80), b]);
};
const len = (n, o) => { if (n < 56) return Buffer.from([o + n]); const h = n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, '0'); return Buffer.concat([Buffer.from([o + 55 + h.length / 2]), Buffer.from(h, 'hex')]); };
const nonce = BigInt(await rpc('eth_getTransactionCount', [key.address, 'pending']));
const fields = [CHAIN, nonce, 1000000n, 100000000n, 21000n, E.GATE_EVM, value, '0x', []];
const pre = Buffer.concat([Buffer.from([2]), enc(fields)]);
const sig = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(pre), Buffer.from(key.private_key.replace(/^0x/, ''), 'hex'), { prehash: false, format: 'recovered' }), 'recovered');
const raw = '0x' + Buffer.concat([Buffer.from([2]), enc([...fields, BigInt(sig.recovery), sig.r, sig.s])]).toString('hex');
const h2 = await rpc('eth_sendRawTransaction', [raw]);
console.log(JSON.stringify({ forward_base_tx: h2, block: parseInt((await receipt(h2)).blockNumber), gate_evm: E.GATE_EVM, gate_balance: BigInt(await rpc('eth_getBalance', [E.GATE_EVM, 'latest'])).toString() }));
