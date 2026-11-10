// The market (arena.nearcarta.near) upgrades in place from state version 1 to 2: stalls, the purse, the
// keepers' council. Dry by default: prints the exact cost of each step. --live --step <name> sends one.
//   topup    the city account pays the extra code storage into the market (bytes x 1e19 yocto)
//   upgrade  owner calls upgrade(raw wasm), 1 yocto; migrate runs in the same batch
//   council  owner seats the nine keepers, quorum 5
// Each step first checks the chain and skips what is already done. Keys come from the env only.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };
import { SHOP_GOODS } from '../shared/market/sim.js';
const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
const bs58 = (await import('bs58')).default;

const ROOT = MAIN.root, MARKET = MAIN.market.contract, TG = 10n ** 12n, BYTE = 10n ** 19n, MILLI = 10n ** 21n;
const WASM = readFileSync(new URL('../contracts/artifacts/market.wasm', import.meta.url));
const META = JSON.parse(readFileSync(new URL('../contracts/artifacts/market.json', import.meta.url), 'utf8'));
const NEW_HASH = bs58.encode(createHash('sha256').update(WASM).digest());
if (NEW_HASH !== META.code_hash) throw new Error('artifact does not match market.json');
const STATE_MARGIN = 200n; // bytes: rules, council and the two new collection headers (~60 B), generous
const KEEPERS = Object.keys(SHOP_GOODS).map((s) => `keeper-${s}.${ROOT}`);
const provider = new JsonRpcProvider({ url: MAIN.rpc });
const near = (y) => (Number(y) / 1e24).toFixed(6);
const acct = (id) => provider.viewAccount({ accountId: id, blockQuery: { finality: 'final' } });
const view = (m, a = {}) => provider.callFunction({ contractId: MARKET, method: m, args: a, blockQuery: { finality: 'final' } });
const prepay = (gas) => gas * 10n ** 9n; // the network holds prepaid gas at up to 1e9 yocto per gas while in flight

async function plan() {
  const [m, root] = await Promise.all([acct(MARKET), acct(ROOT)]);
  const oldBytes = BigInt(META.upgrade_from.bytes), newBytes = BigInt(WASM.length);
  const delta = (newBytes - oldBytes + STATE_MARGIN) * BYTE;
  const free = BigInt(m.amount) - BigInt(m.storage_usage) * BYTE;
  const upgraded = m.code_hash === NEW_HASH;
  return {
    market: { amount: near(m.amount), storage_usage: m.storage_usage, free_near: near(free), code_hash: m.code_hash, upgraded },
    root: { amount: near(root.amount) },
    topup: { yocto: String(delta), near: near(delta), why: `${newBytes - oldBytes} code bytes + ${STATE_MARGIN} state bytes at 1e19 yocto` },
    upgrade: { gas: '150 Tgas', prepaid_near: near(prepay(150n * TG)), burnt_estimate_near: near(60n * TG * 10n ** 8n), deposit: '1 yocto', new_code_hash: NEW_HASH },
    council: { members: KEEPERS, quorum: 5, gas: '20 Tgas' },
    _delta: delta,
  };
}

async function send(receiver, actions, estimate) {
  const before = BigInt((await acct(ROOT)).amount);
  const a = new Account(ROOT, provider, KeyPairSigner.fromSecretKey(process.env.NEAR_MAIN_PRIVATE_KEY));
  const r = await a.signAndSendTransaction({ receiverId: receiver, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const after = BigInt((await acct(ROOT)).amount);
  const fail = [r.status?.Failure, ...(r.receipts_outcome || []).map((o) => o.outcome?.status?.Failure)].find(Boolean);
  const spent = before - after;
  return { hash: r.transaction?.hash, ok: !fail, failure: fail ? JSON.stringify(fail).slice(0, 300) : null, spent_near: near(spent), estimate_near: near(estimate), over_10pct: spent > (estimate * 11n) / 10n };
}

const p = await plan();
const { _delta, ...shown } = p;
console.log(JSON.stringify(shown, null, 1));
const i = process.argv.indexOf('--step');
if (process.argv.includes('--live') && i > 0) {
  const step = process.argv[i + 1]; let out;
  if (step === 'topup') {
    if (p.market.upgraded) out = { skipped: 'already upgraded' };
    else if (BigInt(Math.round(Number(p.market.free_near) * 1e6)) * 10n ** 18n >= _delta + 10n * MILLI) out = { skipped: 'market already holds the storage' };
    else out = await send(MARKET, [A.transfer(_delta)], _delta + 10n ** 20n);
  } else if (step === 'upgrade') {
    if (p.market.upgraded) out = { skipped: 'already upgraded' };
    else out = await send(MARKET, [A.functionCall('upgrade', WASM, 150n * TG, 1n)], 60n * TG * 10n ** 8n + 10n ** 21n);
  } else if (step === 'council') {
    const sq = await view('square', {});
    if (sq.council.members.length) out = { skipped: 'council already seated', council: sq.council };
    else out = await send(MARKET, [A.functionCall('set_council', { members: KEEPERS, quorum: 5 }, 20n * TG, 0n)], 20n * TG * 10n ** 8n + 10n ** 20n);
  } else throw new Error('step: topup | upgrade | council');
  console.log(JSON.stringify({ step, ...out }, null, 1));
  if (out.over_10pct) { console.error('cost ran more than 10% over the estimate: stopping'); process.exit(2); }
}
