// Toll proofs on testnet: the agent's function-call key asks the contract to pay; the contract builds
// the EIP-1559 tx, the MPC signs it, and only allowlisted, in-cap, fee-capped plain transfers get signed.
// The signed raw tx is read from contract state and broadcast to Base Sepolia.
// Usage: TOLL=toll.<owner>.testnet AGENT_KEY_FILE=... OWNER_KEY_FILE=... RECIPIENT=0x... OUT=... node backend/scripts/toll-proofs.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Account, JsonRpcProvider, KeyPairSigner, actions } from 'near-api-js';
import { cfg } from '../src/config.js';
import { view } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env, T = E.TOLL, BASE = 'https://sepolia.base.org';
const provider = new JsonRpcProvider({ url: cfg.rpc });
const acct = f => { const k = JSON.parse(readFileSync(f, 'utf8')); return new Account(k.account_id, provider, KeyPairSigner.fromSecretKey(k.private_key)); };
const agent = acct(E.AGENT_KEY_FILE), owner = acct(E.OWNER_KEY_FILE);
const out = existsSync(E.OUT) ? JSON.parse(readFileSync(E.OUT, 'utf8')) : { toll: T, steps: {} };
const save = () => writeFileSync(E.OUT, JSON.stringify(out, null, 1) + '\n');
const fee = { max_fee_per_gas: '100000000', max_priority_fee_per_gas: '1000000', gas_limit: 21000 };

async function step(name, who, method, args, tgas = 200) {
  if (out.steps[name]) return out.steps[name];
  const r = await who.signAndSendTransaction({ receiverId: T, actions: [actions.functionCall(method, args, BigInt(tgas) * 10n ** 12n, 0n)], waitUntil: 'FINAL', throwOnFailure: false });
  const fail = r.status?.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const s = JSON.stringify(fail || '');
  const rec = { tx: r.transaction.hash, ok: !fail, error: fail ? (s.match(/REFUSED[^"\\]*|Smart contract panicked: [^"\\]+/) || [s.slice(0, 200)])[0] : undefined };
  const sv = r.status?.SuccessValue; if (sv) rec.ret = JSON.parse(Buffer.from(sv, 'base64').toString());
  out.steps[name] = rec; save(); console.log(name, JSON.stringify({ ...rec, ret: rec.ret && { status: rec.ret.status, nonce: rec.ret.nonce, tx_hash: rec.ret.tx_hash } }));
  return rec;
}
const to = E.RECIPIENT.toLowerCase();
const signed = await step('pay_allowlisted_1e13_signed', agent, 'pay', { to, value: '10000000000000', ...fee });
await step('refused_not_allowlisted', agent, 'pay', { to: '0x000000000000000000000000000000000000dead', value: '10000000000000', ...fee });
await step('refused_over_per_tx_cap', agent, 'pay', { to, value: '200000000000000', ...fee });
await step('refused_fee_over_cap', agent, 'pay', { to, value: '10000000000000', ...fee, max_fee_per_gas: '6000000000' });
await step('owner_freeze', owner, 'freeze', {}, 30);
await step('refused_while_frozen', agent, 'pay', { to, value: '10000000000000', ...fee });
await step('owner_unfreeze', owner, 'unfreeze', {}, 30);
await step('refused_agent_key_cannot_freeze', agent, 'freeze', {}, 30).catch(e => { out.steps.refused_agent_key_cannot_freeze = { error: String(e.message || e).slice(0, 160), note: 'the agent key is limited to pay and settle, so the tx is rejected before it runs' }; save(); });

// Broadcast the signed tx (nonce 0) to Base Sepolia.
if (!out.base_tx) {
  const rec = await view(T, 'get_tx', { nonce: signed.ret.nonce });
  const res = await (await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [rec.raw_signed] }) })).json();
  out.base_tx = res.result || null; out.base_broadcast_error = res.error?.message; save();
  console.log('base', JSON.stringify(res));
}
