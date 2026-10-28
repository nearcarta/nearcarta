#!/usr/bin/env node
// A1 on testnet: a visitor charter gets a timelock and an optional DAO from the factory.
// Two fresh faucet accounts (owner, DAO); keys live in memory only. Writes judges/proofs/a1-timelock-dao.json.
// Usage: node scripts/verify/a1_proof.mjs [--wait]   (--wait also waits out the 10 min timelock and applies the change)
import { writeFileSync } from 'node:fs';
import { keyFrom, functionCall, signTx, outcomeOf, rpcClient, viewFn } from '../../shared/vault/tx.js';
const FACTORY = process.env.FACTORY || 'nccharters-53681.testnet';
const rpc = rpcClient(['https://rpc.testnet.fastnear.com', 'https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org']);
const view = (c, m, a) => viewFn(rpc, c, m, a);
const TG = 10n ** 12n, Y = 10n ** 24n, MIN = 600n * 10n ** 9n;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 10);
const steps = [];

async function guest(tag) {
  const accountId = `ncguest-${rnd()}.testnet`, key = keyFrom();
  const r = await fetch('https://helper.nearprotocol.com/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.publicKey }) });
  if (!r.ok) throw new Error('faucet ' + r.status);
  for (let i = 0; i < 30; i++) { try { await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId }); return { accountId, key, tag }; } catch { await sleep(2000); } }
  throw new Error('faucet account missing');
}
async function call(who, receiverId, method, args, { gas = 60n, deposit = 0n, expect = 'ok' } = {}) {
  const ak = await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: who.accountId, public_key: who.key.publicKey });
  const s = signTx({ key: who.key, signerId: who.accountId, receiverId, nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash, actions: [functionCall(method, args, gas * TG, deposit)] });
  const o = outcomeOf(await rpc('send_tx', { signed_tx_base64: s.base64, wait_until: 'FINAL' }));
  const step = { by: who.tag, method, args, tx: s.hash, ok: o.ok, result: o.ok ? o.value : o.error, expected: expect };
  step.pass = expect === 'ok' ? o.ok : !o.ok && String(o.error).includes(expect);
  steps.push(step); console.log(step.pass ? 'PASS' : 'FAIL', who.tag, method, s.hash, step.result ? JSON.stringify(step.result).slice(0, 120) : '');
  return o;
}

const owner = await guest('owner'), dao = await guest('dao');
const name = 'a1-' + rnd(), charter = `${name}.${FACTORY}`;
const cfg = await view(FACTORY, 'get_config');
await call(owner, FACTORY, 'create_charter', { name: name + 'x', policy_delay_ns: String(MIN / 2n) }, { gas: 150n, deposit: Y / 2n, expect: 'ERR_DELAY' });
await call(owner, FACTORY, 'create_charter', { name, policy_delay_ns: String(MIN), dao: dao.accountId }, { gas: 150n, deposit: Y / 2n });
for (let i = 0; i < 20; i++) { try { if (await view(charter, 'get_state')) break; } catch { await sleep(2000); } }
const created = await view(charter, 'get_state'), reg = await view(FACTORY, 'get_charter', { account_id: charter });
const clause = cap => ({ asset: 'Native', receivers: ['bakery.ncpub-17102.testnet'], per_action_cap: String(cap), daily_budget: String(Y / 10n), window_start_min: 0, window_end_min: 0,
  requires_receipt: false, escalation_max: null, min_amount: String(10n ** 21n), max_actions_per_day: 4 });
await call(owner, charter, 'set_clause', { clause_id: 'pay', clause: clause(Y / 100n) });                 // setup window: applies at once
await call(owner, charter, 'close_setup', {});
await call(dao, charter, 'freeze', {});                                                                   // the DAO is a governor
await call(owner, charter, 'unfreeze', {}, { expect: 'ERR_DAO_ONLY_UNFREEZE' });                          // a stolen owner key cannot undo it
await call(dao, charter, 'unfreeze', {});
const widen = await call(owner, charter, 'set_clause', { clause_id: 'pay', clause: clause(Y / 20n) });   // looser cap: queued
const pending = await view(charter, 'get_pending');
const [changeId, ch] = Object.entries(pending)[0] || [];
await call(owner, charter, 'execute_change', { change_id: changeId }, { expect: 'ERR_TIMELOCK_NOT_READY' });
const capBefore = (await view(charter, 'get_clauses')).pay.per_action_cap;
let capAfter = null;
if (process.argv.includes('--wait')) {
  const ms = Number(BigInt(ch.eta) / 1_000_000n) - Date.now() + 15_000; console.log('waiting', Math.round(ms / 1000), 's for the timelock');
  await sleep(Math.max(0, ms));
  await call(owner, charter, 'execute_change', { change_id: changeId });
  capAfter = (await view(charter, 'get_clauses')).pay.per_action_cap;
}
const checks = {
  below_min_delay_refused: steps[0].pass,
  timelock_is_requested_value: created.policy_delay_ns === String(MIN) && reg.policy_delay_ns === String(MIN),
  dao_recorded: created.dao === dao.accountId && reg.dao === dao.accountId,
  owner_cannot_unfreeze_dao_freeze: steps.find(s => s.method === 'unfreeze' && s.by === 'owner').pass,
  widening_queued_not_applied: !!ch && capBefore === String(Y / 100n) && !widen.value?.applied === !!ch,
  execute_before_eta_refused: steps.find(s => s.method === 'execute_change').pass,
  ...(capAfter ? { applied_after_eta: capAfter === String(Y / 20n) } : {}),
};
const proof = { what: 'A1: factory charters get a timelock (default 24 h, min 10 min, max 30 d) and an optional DAO', at: new Date().toISOString(), network: 'testnet',
  factory: FACTORY, factory_config: { default_policy_delay_ns: cfg.default_policy_delay_ns, min_policy_delay_ns: cfg.min_policy_delay_ns, max_policy_delay_ns: cfg.max_policy_delay_ns, code_hash: cfg.code_hash },
  charter, owner: owner.accountId, dao: dao.accountId, state_at_create: { policy_delay_ns: created.policy_delay_ns, dao: created.dao, setup_open: created.setup_open },
  queued_change: ch ? { id: changeId, eta: ch.eta, kind: Object.keys(ch.change || {})[0] } : null, cap_before: capBefore, cap_after: capAfter, checks,
  pass: Object.values(checks).every(Boolean), steps };
writeFileSync(new URL('../../judges/proofs/a1-timelock-dao.json', import.meta.url), JSON.stringify(proof, null, 2) + '\n');
console.log(proof.pass ? 'A1 PASS' : 'A1 FAIL', JSON.stringify(checks));
process.exit(proof.pass ? 0 : 1);
