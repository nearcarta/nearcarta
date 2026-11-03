// Attested charter check on OutLayer (testnet only).
// 1) Creates a keyless account check-<t>.<funder>, deploys contracts/artifacts/attested_check.wasm, init pins
//    outlayer/artifacts/charter_check.wasm (served by the app) by its sha256.
// 2) For one allowed and one over-cap payment on the Guardhouse charter: the attested check (OutLayer TEE run
//    of the pay clause), then the charter's own propose, which stays the final gate.
// Usage: FUNDER_FILE=<json account_id, private_key> AGENT_FILE=<guardhouse propose-only key json>
//        OUT=../judges/proofs/outlayer.json [CONTRACT=<existing>] node scripts/outlayer-check.js
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';
import { accessKeys } from '../src/near.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env;
const dep = JSON.parse(readFileSync(new URL('../../shared/deployments/testnet.json', import.meta.url), 'utf8'));
const CHARTER = E.CHARTER || dep.guardhouse?.oath || 'guardhouse-nzjp.nccharters-22195.testnet';
const OUTLAYER = 'outlayer.testnet';
const WASM_URL = 'https://nearcarta.vercel.app/outlayer/charter_check.wasm';
const checker = readFileSync(new URL('../../outlayer/artifacts/charter_check.wasm', import.meta.url));
const proxyWasm = readFileSync(new URL('../../contracts/artifacts/attested_check.wasm', import.meta.url));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const F = JSON.parse(readFileSync(E.FUNDER_FILE, 'utf8')), G = JSON.parse(readFileSync(E.AGENT_FILE, 'utf8'));
if (G.account_id !== CHARTER) { console.error('agent key is not for', CHARTER); process.exit(2); }
const provider = new JsonRpcProvider({ url: cfg.rpc });
const funder = new Account(F.account_id, provider, KeyPairSigner.fromSecretKey(F.private_key));
const agent = new Account(G.account_id, provider, KeyPairSigner.fromSecretKey(G.private_key));
const C = E.CONTRACT || `check-${Date.now().toString(36)}.${F.account_id}`;
const N = x => (BigInt(Math.round(x * 1e6)) * 10n ** 18n).toString();
const TG = t => BigInt(t) * 10n ** 12n;
const near = y => Number(BigInt(y)) / 1e24;
const vw = async (id, m, a = {}) => JSON.parse(Buffer.from((await provider.query({ request_type: 'call_function', finality: 'final', account_id: id, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString());
const bal = async id => BigInt((await provider.query({ request_type: 'view_account', finality: 'final', account_id: id })).amount);
const out = { network: 'testnet', outlayer: OUTLAYER, proxy: C, charter: CHARTER, checker: { url: WASM_URL, sha256: sha(checker), bytes: checker.length, target: 'wasm32-wasip1', source: 'outlayer/charter_check' }, proxy_wasm_sha256: sha(proxyWasm), steps: [] };
const save = () => E.OUT && writeFileSync(E.OUT, JSON.stringify(out, null, 1) + '\n');
async function send(step, who, receiverId, actions) {
  const before = await bal(who.accountId);
  const r = await who.signAndSendTransaction({ receiverId, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const bad = r.status.Failure || r.receipts_outcome.find(o => o.outcome.status.Failure)?.outcome.status.Failure;
  const burnt = r.receipts_outcome.reduce((s, o) => s + BigInt(o.outcome.tokens_burnt), BigInt(r.transaction_outcome.outcome.tokens_burnt));
  const ret = r.status.SuccessValue ? JSON.parse(Buffer.from(r.status.SuccessValue, 'base64').toString() || 'null') : undefined;
  await new Promise(s => setTimeout(s, 4000)); // let refunds land
  const rec = { step, tx: r.transaction.hash, signer: who.accountId, ok: !bad, gas_burnt_near: near(burnt), signer_net_cost_near: near(before - await bal(who.accountId)), ret, ...(bad ? { error: JSON.stringify(bad).slice(0, 300) } : {}) };
  console.log(JSON.stringify({ step, ok: rec.ok, tx: rec.tx, cost: rec.signer_net_cost_near, decision: ret?.decision, status: ret?.status }));
  out.steps.push(rec); save(); return rec;
}
// ATTEST_ONLY=1 re-reads the attestations for the runs already in OUT.
if (E.ATTEST_ONLY) Object.assign(out, JSON.parse(readFileSync(E.OUT, 'utf8')));
else {
if (!E.CONTRACT) {
  const d = await send('deploy_proxy', funder, C, [A.createAccount(), A.transfer(BigInt(N(Number(E.FUND || 2)))), A.deployContract(proxyWasm),
    A.functionCall('new', { owner: F.account_id, outlayer: OUTLAYER, wasm_url: WASM_URL, wasm_hash: sha(checker) }, TG(30), 0n)]);
  if (!d.ok) process.exit(1);
}
out.proxy_keys = ((await accessKeys(C)).keys || []).length;
out.config = await vw(C, 'get_config');
const clause_id = E.CLAUSE || 'tip2';
const clause = (await vw(CHARTER, 'get_clauses'))[clause_id];
const rcv = clause.receivers[0];
out.clause = { clause_id, per_action_cap: clause.per_action_cap, daily_budget: clause.daily_budget, receivers: clause.receivers };
const pair = async (label, amount) => {
  const chk = await send(`attested_check_${label}`, funder, C, [A.functionCall('check', { charter: CHARTER, clause_id, receiver: rcv, amount }, TG(300), BigInt(N(Number(E.DEPOSIT || 0.05))))]);
  const st = await vw(CHARTER, 'get_state');
  const gate = await send(`charter_propose_${label}`, agent, CHARTER, [A.functionCall('propose', { p: { shop: 'guardhouse', clause_id, receiver: rcv, amount, nonce: String(st.next_nonce), policy_version: st.policy_version, expires_at: String((BigInt(Date.now()) + 600000n) * 1_000_000n), memo: `attested ${label}`, receipt: null } }, TG(150), 0n)]);
  return { chk, gate };
};
out.allowed = await pair('allowed', N(0.005));
out.denied = await pair('over_cap', N(0.05));
out.last = await vw(C, 'get_last', { n: 2 });
out.cost_per_check_near = out.steps.filter(s => s.step.startsWith('attested_check_')).map(s => s.signer_net_cost_near);
out.recorded_at = new Date().toISOString();
save();
}
// OutLayer's TDX attestation for each run: same wasm sha256 as the pin, input_hash == sha256(input on chain).
const API = 'https://testnet-api.outlayer.ai';
out.attestations = [];
for (const s of out.steps.filter(x => x.step.startsWith('attested_check_'))) {
  const r = await (await fetch(cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'EXPERIMENTAL_tx_status', params: { tx_hash: s.tx, sender_account_id: s.signer, wait_until: 'FINAL' } }) })).json();
  const logs = r.result.receipts_outcome.flatMap(o => o.outcome.logs);
  const req = logs.map(l => l.match(/\\"request_id\\":(\d+)/) || l.match(/"request_id\\?":(\d+)/)).find(Boolean)?.[1];
  const charged = logs.map(l => l.match(/"payment_charged":"(\d+)"/)).find(Boolean)?.[1];
  const a = await (await fetch(`${API}/attestations/by-request/${req}`)).json();
  const rec = out.last.find(c => c.input && sha(Buffer.from(c.input)) === a.input_hash);
  out.attestations.push({ step: s.step, request_id: Number(req), outlayer_charged_near: charged ? near(charged) : null, url: `${API}/attestations/by-request/${req}`,
    attestation_id: a.id, transaction_hash: a.transaction_hash, wasm_hash: a.wasm_hash, executed_wasm_sha256: a.executed_wasm_sha256, input_hash: a.input_hash, output_hash: a.output_hash,
    worker_measurement: a.worker_measurement, tdx_quote_bytes: a.tdx_quote?.length, wasm_matches_pin: a.executed_wasm_sha256 === out.checker.sha256 && a.transaction_hash === s.tx,
    input_matches_chain: !!rec, decision: rec?.decision });
}
save();
console.log(JSON.stringify(out.attestations.map(a => [a.step, a.request_id, a.wasm_matches_pin, a.input_matches_chain, a.decision, a.outlayer_charged_near])));
