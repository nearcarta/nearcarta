// TEARDOWN for core-deploy.js: brings every locked yocto back to the root (the owner).
//   toll:    root calls close() with 1 yocto -> the toll deletes itself to the owner.
//   charter: root queue_upgrade(sha256 of reaper.wasm) -> waits the 90 s timelock -> execute_change ->
//            upgrade (raw reaper.wasm as input) -> reap() with 1 yocto -> the charter deletes itself to the owner.
// Usage: NET=testnet|mainnet ROOT_KEY=<json> DEPLOY=<core-deploy OUT json> OUT=<json> node backend/scripts/core-teardown.js
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPairSigner, actions as A } from 'near-api-js';
const E = process.env;
const rpc = { testnet: 'https://rpc.testnet.fastnear.com', mainnet: 'https://rpc.mainnet.fastnear.com' }[E.NET];
const RPCURL = E.RPC || rpc;
const rq = async params => { const r = await (await fetch(RPCURL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }) })).json(); if (r.error || r.result?.error) throw new Error(JSON.stringify(r.error || r.result.error)); return r.result; };
const provider = new JsonRpcProvider({ url: RPCURL });
const RK = JSON.parse(readFileSync(E.ROOT_KEY, 'utf8')); const D = JSON.parse(readFileSync(E.DEPLOY, 'utf8'));
const root = new Account((E.ROOT_ID || RK.account_id), provider, KeyPairSigner.fromSecretKey(RK.private_key));
const C = D.charter, T = D.toll, TG = t => BigInt(t) * 10n ** 12n, near = y => Number(BigInt(y) / 10n ** 18n) / 1e6;
const acct = id => rq({ request_type: 'view_account', finality: 'final', account_id: id }).catch(e => ({ gone: String(e.message || e).slice(0, 120) }));
const view = async (c, m, a = {}) => JSON.parse(Buffer.from((await rq({ request_type: 'call_function', finality: 'final', account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString());
const S = { network: E.NET, root: (E.ROOT_ID || RK.account_id), charter: C, toll: T, steps: [] }; const save = () => writeFileSync(E.OUT, JSON.stringify(S, null, 1));
async function send(step, receiverId, actions) {
  const r = await root.signAndSendTransaction({ receiverId, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const burnt = r.receipts_outcome.reduce((s, o) => s + BigInt(o.outcome.tokens_burnt), BigInt(r.transaction_outcome.outcome.tokens_burnt));
  const ret = r.status.SuccessValue ? Buffer.from(r.status.SuccessValue, 'base64').toString().slice(0, 300) : undefined;
  const rec = { step, tx: r.transaction.hash, ok: !bad, gas_burnt_near: near(burnt), ret, ...(bad ? { error: JSON.stringify(bad).slice(0, 300) } : {}) };
  console.log(JSON.stringify(rec)); S.steps.push(rec); save(); if (bad) process.exit(1); return rec;
}
const before = await acct((E.ROOT_ID || RK.account_id)); S.root_before_near = near(before.amount);
const c0 = await acct(C), t0 = await acct(T);
S.before = { charter_near: c0.amount ? near(c0.amount) : null, toll_near: t0.amount ? near(t0.amount) : null };
if (t0.amount) await send('toll_close', T, [A.functionCall('close', {}, TG(50), 1n)]);
if (c0.amount) {
  const reaper = readFileSync(new URL('../../contracts/artifacts/' + (process.env.REAPER_WASM || 'reaper.wasm'), import.meta.url));
  const h = crypto.createHash('sha256').update(reaper).digest('hex'); S.reaper_sha256 = h;
  const q = await send('charter_queue_upgrade_reaper', C, [A.functionCall('queue_upgrade', { code_hash: h }, TG(50), 0n)]);
  const pend = await view(C, 'get_pending'); const id = Object.keys(pend).find(k => JSON.stringify(pend[k]).includes(h));
  const eta = Number(BigInt(pend[id].eta) / 1_000_000n); S.timelock_wait_s = Math.max(0, Math.ceil((eta - Date.now()) / 1000) + 5);
  console.log('waiting', S.timelock_wait_s, 's for the timelock'); await new Promise(r => setTimeout(r, S.timelock_wait_s * 1000));
  await send('charter_execute_change', C, [A.functionCall('execute_change', { change_id: String(id) }, TG(50), 0n)]);
  await send('charter_upgrade_to_reaper', C, [A.functionCall('upgrade', reaper, TG(100), 0n)]);
  S.reaper_owner_view = await view(C, 'owner');
  await send('charter_reap', C, [A.functionCall('reap', {}, TG(50), 1n)]);
}
// the delete_account refund lands one receipt after the tx; give it a few blocks
await new Promise(r => setTimeout(r, 8000));
const after = await acct((E.ROOT_ID || RK.account_id));
S.after = { charter: await acct(C), toll: await acct(T), root_after_near: near(after.amount) };
S.root_gain_near = near(BigInt(after.amount) - BigInt(before.amount));
S.recovered_vs_contract_balances_near = (S.before.charter_near || 0) + (S.before.toll_near || 0);
save(); console.log(JSON.stringify({ root_gain_near: S.root_gain_near, contract_balances_before_near: S.recovered_vs_contract_balances_near, charter_after: S.after.charter, toll_after: S.after.toll }, null, 1));
