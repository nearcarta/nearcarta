// Toll visitor proof on testnet, the same steps the Toll shop runs in the browser:
// a fresh guest account (testnet helper) builds its own charter, signs its rules and a propose-only agent key;
// the agent asks the charter to pay the 0.01 NEAR toll; the guest's wallet calls gate.pay_for(charter, action);
// the gate reads the charter on chain and MPC-signs a Base Sepolia payout from its own derived address; the raw
// tx is read from the gate and broadcast; after Base finality the guest calls settle and the MPC foreign-tx proof
// makes the record confirmed. A second guest whose max per payment is below the toll is refused by its charter,
// and the gate refuses that action, a replay, and a charter action that was not a toll payment.
// Usage (testnet only): GATE=gate.<owner>.testnet KEYS=.secrets/toll-visitor/guests.json OUT=judges/proofs/toll-visitor.json node backend/scripts/toll-visitor.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { rpcClient, viewFn, keyFrom, signTx, functionCall, sendPropose, outcomeOf } from '../../shared/vault/tx.js';

const E = process.env, GATE = E.GATE, FACTORY = 'nccharters-53681.testnet', PAYEE = 'cafe.ncpub-17102.testnet';
const RPC = 'https://rpc.testnet.near.org', BASE = 'https://sepolia.base.org', FAUCET = 'https://helper.nearprotocol.com/account';
const rpc = rpcClient([RPC, 'https://test.rpc.fastnear.com']);
const view = (c, m, a = {}) => viewFn(rpc, c, m, a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toY = n => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const K = existsSync(E.KEYS) ? JSON.parse(readFileSync(E.KEYS, 'utf8')) : {};
const saveK = () => writeFileSync(E.KEYS, JSON.stringify(K), { mode: 0o600 });
const out = existsSync(E.OUT) ? JSON.parse(readFileSync(E.OUT, 'utf8')) : { gate: GATE, steps: {} };
const save = () => writeFileSync(E.OUT, JSON.stringify(out, null, 1) + '\n');
const evm = async (method, params) => { const j = await (await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); if (j.error) throw new Error(j.error.message); return j.result; };
const errOf = s => (JSON.stringify(s).match(/REFUSED[^"\\]*|Smart contract panicked: [^"\\]+|ERR_[A-Z_]+/) || [JSON.stringify(s).slice(0, 200)])[0];

async function send(signerId, secret, receiverId, actions) {
  const key = keyFrom(secret);
  const ak = await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: signerId, public_key: key.publicKey });
  const s = signTx({ key, signerId, receiverId, nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash, actions });
  const r = await rpc('send_tx', { signed_tx_base64: s.base64, wait_until: 'FINAL' });
  const fails = r.receipts_outcome.filter(o => o.outcome.status.Failure);
  return { tx: s.hash, ok: !r.status.Failure && !fails.length, error: fails.length || r.status.Failure ? errOf(r.status.Failure || fails[0].outcome.status.Failure) : undefined,
    ret: r.status.SuccessValue ? JSON.parse(Buffer.from(r.status.SuccessValue, 'base64').toString() || 'null') : undefined,
    logs: r.receipts_outcome.flatMap(o => o.outcome.logs) };
}
async function step(name, fn) {
  if (out.steps[name]) return out.steps[name];
  const t0 = Date.now(); const rec = await fn(); rec.ms = Date.now() - t0; rec.at = new Date().toISOString();
  out.steps[name] = rec; save(); console.log(name, JSON.stringify({ ...rec, logs: undefined }).slice(0, 400)); return rec;
}

async function guest(tag, cap) {
  if (!K[tag]) {
    const key = keyFrom(); const id = `ncguest-tv${Math.random().toString(36).slice(2, 10)}.testnet`;
    const r = await fetch(FAUCET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: key.publicKey }) });
    if (!r.ok) throw new Error('helper ' + r.status);
    K[tag] = { id, secret: key.secretKey }; saveK();
    for (let i = 0; i < 30; i++) { try { await rpc('query', { request_type: 'view_account', finality: 'final', account_id: id }); break; } catch { await sleep(2000); } }
  }
  const g = K[tag];
  await step(`${tag}_account`, async () => ({ account: g.id, note: 'fresh testnet account from the helper; its key never left this script' }));
  const built = await step(`${tag}_create_charter`, async () => {
    const name = g.id.split('.')[0].slice(0, 18) + '-' + Math.random().toString(36).slice(2, 6);
    const r = await send(g.id, g.secret, FACTORY, [functionCall('create_charter', { name }, 150n * 10n ** 12n, BigInt(toY(1)))]);
    return { ...r, charter: `${name}.${FACTORY}`, logs: undefined };
  });
  g.charter = built.charter;
  for (let i = 0; i < 20 && !(await view(FACTORY, 'is_charter', { account_id: g.charter })); i++) await sleep(1500);
  await step(`${tag}_sign_rules`, async () => {
    if (!g.agent) { g.agent = keyFrom().secretKey; saveK(); }
    const clause = { asset: 'Native', receivers: [PAYEE, 'books.ncpub-17102.testnet', g.id], per_action_cap: toY(cap), daily_budget: toY(0.2), window_start_min: 0, window_end_min: 0,
      requires_receipt: false, escalation_max: null, min_amount: toY(0.001), max_actions_per_day: 8 };
    const r = await send(g.id, g.secret, g.charter, [functionCall('set_clause', { clause_id: 'pay', clause }, 40n * 10n ** 12n),
      functionCall('set_agent_key', { public_key: keyFrom(g.agent).publicKey, allowance: (5n * 10n ** 23n).toString() }, 60n * 10n ** 12n)]);
    return { ...r, rules: { per_action_cap: clause.per_action_cap, daily_budget: clause.daily_budget, receivers: clause.receivers }, logs: undefined };
  });
  const asked = await step(`${tag}_agent_asks_toll`, async () => {
    const st = await view(g.charter, 'get_state');
    const p = { shop: 'toll', clause_id: 'pay', receiver: PAYEE, amount: toY(0.01), nonce: String(st.next_nonce), policy_version: st.policy_version,
      expires_at: String(BigInt(Date.now() + 600_000) * 1_000_000n), memo: 'toll:base-sepolia', receipt: null };
    const r = await sendPropose(rpc, { key: keyFrom(g.agent), charter: g.charter, p });
    const v = r.value || {};
    return { tx: r.hash, signer: `${g.charter} (agent function-call key, propose only)`, decision: v.decision, reason: v.reason, action_id: v.action_id ?? null };
  });
  let action = null;
  if (asked.action_id != null) for (let i = 0; i < 20; i++) { action = await view(g.charter, 'get_action', { action_id: String(asked.action_id) }); if (action?.status === 'confirmed') break; await sleep(1500); }
  out.steps[`${tag}_agent_asks_toll`].action_onchain = action; save();
  return { g, asked, action };
}

// ---- allowed guest: max per payment 0.05 NEAR ----
const A = await guest('allowed', 0.05);
const paid = await step('allowed_pay_for', async () => {
  const r = await send(A.g.id, A.g.secret, GATE, [functionCall('pay_for', { charter: A.g.charter, action_id: String(A.asked.action_id) }, 300n * 10n ** 12n)]);
  return { ...r, signer: A.g.id, ret: r.ret && { nonce: r.ret.nonce, status: r.ret.status, to: r.ret.to, value: r.ret.value, tx_hash: r.ret.tx_hash } };
});
const nonce = paid.ret?.nonce ?? await view(GATE, 'visit_nonce', { charter: A.g.charter, action_id: String(A.asked.action_id) });
const bc = await step('broadcast', async () => {
  const rec = await view(GATE, 'get_tx', { nonce });
  const h = await evm('eth_sendRawTransaction', [rec.raw_signed]).catch(e => e.message.includes('already known') ? rec.tx_hash : Promise.reject(e));
  let rc = null; for (let i = 0; i < 60 && !rc; i++) { rc = await evm('eth_getTransactionReceipt', [h]); if (!rc) await sleep(2000); }
  return { base_sepolia_tx: h, from: (await evm('eth_getTransactionByHash', [h])).from, status: rc.status, block: parseInt(rc.blockNumber), block_hash: rc.blockHash, raw_read_from: `${GATE}.get_tx(${nonce})` };
});

// ---- over-cap guest and gate refusals while Base finalizes ----
const B = await guest('overcap', 0.005);
await step('overcap_gate_refuses', async () => ({ ...(await send(B.g.id, B.g.secret, GATE, [functionCall('pay_for', { charter: B.g.charter, action_id: String(B.asked.action_id ?? 0) }, 300n * 10n ** 12n)])), logs: undefined }));
await step('replay_refused', async () => ({ ...(await send(B.g.id, B.g.secret, GATE, [functionCall('pay_for', { charter: A.g.charter, action_id: String(A.asked.action_id) }, 300n * 10n ** 12n)])), logs: undefined }));
if (E.NON_TOLL_CHARTER) await step('non_toll_action_refused', async () => ({ charter: E.NON_TOLL_CHARTER, ...(await send(B.g.id, B.g.secret, GATE, [functionCall('pay_for', { charter: E.NON_TOLL_CHARTER, action_id: '0' }, 300n * 10n ** 12n)])), logs: undefined }));

// ---- settle after Base finality ----
await step('settle', async () => {
  for (;;) { const f = await evm('eth_getBlockByNumber', ['finalized', false]); if (parseInt(f.number) >= bc.block) { out.base_finalized_head_at_settle = parseInt(f.number); break; } console.log('waiting finality', bc.block - parseInt(f.number)); await sleep(30000); }
  const r = await send(A.g.id, A.g.secret, GATE, [functionCall('settle', { nonce, block_hash: bc.block_hash }, 150n * 10n ** 12n)]);
  return { ...r, signer: A.g.id, ret: r.ret && { status: r.ret.status, proof_payload_hash: r.ret.proof_payload_hash } };
});
out.final = { gate_record: await view(GATE, 'get_tx', { nonce }), visit: await view(GATE, 'get_visit', { nonce }), policy: await view(GATE, 'policy') };
delete out.final.gate_record.raw_signed; save();
console.log('final', out.final.gate_record.status);
