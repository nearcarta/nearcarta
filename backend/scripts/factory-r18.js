// R18 charter factory on testnet (testnet only; never prints a private key).
// R18 = the R17 oath plus an optional agent key allowance (0cbc168): set_agent_key(allowance: null) adds a
// function-call key with no gas cap, limited to this charter and propose/propose_batch. Artifact contracts/artifacts/oath.r18.wasm.
// The public faucet rate-limits (429), so fund moves spare testnet NEAR from our own testnet wallets (DONORS = key files):
//   fund     create the publisher and factory accounts via the `testnet` registrar, paid by donors
//   publish  deploy-as-global the oath by code hash (10 NEAR per 100 KB), check view_global_contract_code
//   factory  deploy contracts/artifacts/charter_factory.r15.wasm + new(code_hash) in one tx, then delete
//            the factory's only full-access key (0 keys: no admin, no upgrade)
//   smoke    the publisher creates smoke.<factory>; view_account shows the global code hash in use
// Usage: SEC=dir for key files (0600)  STATE=state json  OUT=proof json  node backend/scripts/factory-r17.js <step>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import bs58 from 'bs58';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const E = process.env, STEP = process.argv[2];
const provider = new JsonRpcProvider({ url: cfg.rpc });
const NEAR = 10n ** 24n, MILLI = 10n ** 21n, TG = t => BigInt(t) * 10n ** 12n;
const OATH = 'contracts/artifacts/oath.r18.wasm', FACTORY = 'contracts/artifacts/charter_factory.r15.wasm';
const art = p => readFileSync(new URL('../../' + p, import.meta.url));
const sha = b => crypto.createHash('sha256').update(b).digest();
const st = existsSync(E.STATE) ? JSON.parse(readFileSync(E.STATE, 'utf8')) : {};
const save = () => writeFileSync(E.STATE, JSON.stringify(st, null, 1));
const log = (label, extra = {}) => { const e = { t: new Date().toISOString(), label, ...extra }; if (e.tx) e.url = `https://testnet.nearblocks.io/txns/${e.tx}`; console.log(JSON.stringify(e).slice(0, 500)); (st.log ||= []).push(e); save(); return e; };
const kfile = n => `${E.SEC}/${n}.json`;
function key(n, account) {
  if (existsSync(kfile(n))) return JSON.parse(readFileSync(kfile(n), 'utf8'));
  const kp = KeyPair.fromRandom('ed25519'); const k = { account_id: account, public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
  writeFileSync(kfile(n), JSON.stringify(k), { mode: 0o600 }); return k;
}
const acct = n => { const k = key(n); return new Account(k.account_id, provider, KeyPairSigner.fromSecretKey(k.private_key)); };
const view = async a => { try { return await provider.query({ request_type: 'view_account', finality: 'final', account_id: a }); } catch { return null; } };
const call = async (c, m, a = {}) => { const r = await provider.query({ request_type: 'call_function', finality: 'final', account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') }); return JSON.parse(Buffer.from(r.result).toString()); };
const keysOf = async a => (await provider.query({ request_type: 'view_access_key_list', finality: 'final', account_id: a })).keys;
async function send(label, signer, receiverId, actions) {
  const r = await signer.signAndSendTransaction({ receiverId, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const fails = r.receipts_outcome.filter(o => o.outcome.status.Failure);
  const ok = !r.status.Failure && !fails.length;
  const gas = r.receipts_outcome.reduce((s, o) => s + BigInt(o.outcome.gas_burnt), BigInt(r.transaction_outcome.outcome.gas_burnt));
  const e = log(label, { tx: r.transaction.hash, ok, gas_tgas: Number(gas / 10n ** 9n) / 1000, error: ok ? undefined : JSON.stringify(r.status.Failure || fails[0].outcome.status.Failure).slice(0, 300) });
  if (!ok) throw new Error(label + ' failed'); return e;
}
async function faucet(n, account) {
  const k = key(n, account); if (await view(account)) return;
  const res = await fetch('https://helper.nearprotocol.com/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: account, newAccountPublicKey: k.public_key }) });
  for (let i = 0; i < 40; i++) { const a = await view(account); if (a) { log(`faucet ${account}`, { http: res.status, balance_near: Number(BigInt(a.amount) / MILLI) / 1000 }); return; } await new Promise(r => setTimeout(r, 2000)); }
  throw new Error('faucet account not visible: ' + account + ' http ' + res.status);
}

const steps = {
  async fund() {
    st.sfx ||= String(10000 + crypto.randomInt(90000)); st.pub ||= `ncpub-${st.sfx}.testnet`; st.factory ||= `nccharters-${st.sfx}.testnet`; save();
    const donors = E.DONORS.split(',').map(f => JSON.parse(readFileSync(f, 'utf8')));
    const dacct = d => new Account(d.account_id, provider, KeyPairSigner.fromSecretKey(d.private_key));
    const keep = 1n * NEAR;
    for (const [n, id, amt] of [['pub', st.pub, 2n * NEAR], ['factory', st.factory, 3n * NEAR]]) {
      if (await view(id)) continue;
      await send(`create ${id}`, dacct(donors[0]), 'testnet', [A.functionCall('create_account', { new_account_id: id, new_public_key: key(n, id).public_key }, TG(50), amt)]);
    }
    for (const d of donors) {
      if (st['donated_' + d.account_id]) continue;
      const a = await view(d.account_id), free = BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n - keep;
      if (free > 0n) await send(`move spare ${d.account_id} -> publisher`, dacct(d), st.pub, [A.transfer(free)]);
      st['donated_' + d.account_id] = 1; save();
    }
    log('publisher balance', { near: Number(BigInt((await view(st.pub)).amount) / MILLI) / 1000 });
  },
  async publish() {
    const code = art(OATH), h = bs58.encode(sha(code));
    st.oath = { artifact: OATH, bytes: code.length, sha256: sha(code).toString('hex'), code_hash: h }; save();
    if (!st.published) { st.published = (await send('deploy-as-global R18 oath (by hash)', acct('pub'), st.pub, [A.deployGlobalContract(code, 'codeHash')])).tx; save(); }
    const g = await provider.sendJsonRpc('query', { request_type: 'view_global_contract_code', finality: 'final', code_hash: h });
    const live = Buffer.from(g.code_base64, 'base64');
    st.oath.global_matches_artifact = live.equals(code); save();
    log('global code by hash', { code_hash: h, bytes: live.length, equals_artifact: live.equals(code) });
  },
  async factory() {
    const code = art(FACTORY), f = st.factory;
    st.factory_wasm = { artifact: FACTORY, bytes: code.length, sha256: sha(code).toString('hex'), code_hash: bs58.encode(sha(code)) }; save();
    if (!st.factory_deployed) { st.factory_deployed = (await send('deploy factory + new(code_hash)', acct('factory'), f, [A.deployContract(code), A.functionCall('new', { code_hash: st.oath.code_hash, min_deposit: null }, TG(30), 0n)])).tx; save(); }
    log('factory config', { config: await call(f, 'get_config') });
    if (!st.factory_locked) { const k = key('factory'); st.factory_locked = (await send('delete factory full-access key (factory locked)', acct('factory'), f, [A.deleteKey(KeyPair.fromString(k.private_key).getPublicKey())])).tx; save(); }
    const a = await view(f), ks = await keysOf(f);
    st.factory_onchain = { code_hash: a.code_hash, matches_artifact: a.code_hash === st.factory_wasm.code_hash, keys: ks.length }; save();
    log('factory on chain', st.factory_onchain);
  },
  async smoke() {
    const c = `smoke.${st.factory}`;
    if (!(await view(c))) { st.smoke_created = (await send('create smoke charter via factory', acct('pub'), st.factory, [A.functionCall('create_charter', { name: 'smoke', policy_delay_ns: null, dao: null }, TG(120), 5n * NEAR / 10n)])).tx; save(); }
    const a = await view(c), s = await call(c, 'get_state'), ks = await keysOf(c);
    st.smoke = { charter: c, global_contract_hash: a.global_contract_hash, matches: a.global_contract_hash === st.oath.code_hash, keys: ks.length, owner: s.owner, setup_open: s.setup_open, policy_delay_ns: s.policy_delay_ns, registered: await call(st.factory, 'is_charter', { account_id: c }) }; save();
    log('smoke charter', st.smoke);
  },
};
if (!steps[STEP]) { console.error('step: fund|publish|factory|smoke'); process.exit(2); }
await steps[STEP]();
if (E.OUT) writeFileSync(E.OUT, JSON.stringify({ ...st, log: undefined, txs: (st.log || []).filter(e => e.tx).map(({ label, tx, ok, gas_tgas }) => ({ label, tx, ok, gas_tgas })) }, null, 1));
