// Put the market on <dep.market.contract>: repay the visitor pot, close arena v1, create the market.
// Dry by default: prints the exact cost of each step. --live --step <repay|close|create|smoke> signs one step.
//
// Network comes from NEAR_NETWORK and the addresses from shared/deployments/<network>.json
// (shared/deployments/net.js). With no NEAR_NETWORK the record is mainnet and every printed line
// matches what this script printed before the record could be chosen. --live refuses when the
// signer's suffix does not belong to the chosen network, so a testnet run cannot pick up a mainnet key.
// Docs: https://docs.near.org/smart-contracts/release/deploy · https://docs.near.org/tools/cli
//       https://docs.near.org/protocol/accounts-contracts/account-id
//
// Keys come from the environment and are never printed:
//   NEAR_MAIN_PRIVATE_KEY      the owner account in the record (nearcarta.near / nearcarta.testnet)
//   NEAR_IMPLICIT_PRIVATE_KEY  the held visitor wallet, used as the stranger in the smoke test
//   MARKET_WASM                reproducible build (nep330) of contracts/market
//   MARKET_WASM_TESTNET        the testnet build, when it differs from the mainnet artifact
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { deployContext, liveHint } from './lib/deploy-net.js';

const net = deployContext(process.argv, { signer: process.env.NEAR_MAIN_PRIVATE_KEY ? '' : '' });
const DEP = net.dep;
const NETWORK = net.network;

const RPC = DEP.rpc;
const OWNER = DEP.root;
const ACCOUNT = DEP.market?.contract || DEP.planned?.arena;
const BOARD = DEP.board.contract;
// Only the mainnet record has a held visitor pot to repay and an arena v1 to close.
const VISITOR = DEP.root_funder || '';
const POT_TOKEN = 'g-visitor-1';
const BYTE = 10n ** 19n;
const MILLI = 10n ** 21n;
const TG = 10n ** 12n;
const GAS_PREPAY = 10n ** 9n; // yocto per gas, prepaid, the unused part comes back
// The record owns the caps so a demo network can raise the city float without a redeploy.
export const CAPS = DEP.market?.caps || {
  gathers_per_day: 40,
  player_payout_per_day: String(5n * MILLI),
  city_payout_per_day: String(50n * MILLI),
  storage_min: String(5n * MILLI),
};
// 100 account + wasm + STATE record (5 + 40) + up to 400 bytes of initial state. 0.05 NEAR slack covers the first shops.
const STATE_BYTES = 400n;
const SLACK = 50n * MILLI;

const near = y => { const v = BigInt(y); const w = v / 10n ** 24n; const f = (v % 10n ** 24n).toString().padStart(24, '0').slice(0, 6); return `${w}.${f}`; };
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(x => x.json());
  if (r.error) throw Object.assign(new Error(r.error.cause?.name || r.error.message), { rpc: r.error });
  return r.result;
}
const account = id => rpc('query', { request_type: 'view_account', finality: 'final', account_id: id }).catch(() => null);
async function view(id, method, args = {}) {
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  return JSON.parse(Buffer.from(r.result).toString() || 'null');
}

function wasm() {
  const file = (NETWORK === 'testnet' ? process.env.MARKET_WASM_TESTNET : '') || process.env.MARKET_WASM || '/workspace/near/build-mainnet/market.wasm';
  if (!existsSync(file)) throw new Error('no market wasm at ' + file + ' (set MARKET_WASM)');
  const bytes = readFileSync(file);
  return { bytes, sha: createHash('sha256').update(bytes).digest('hex') };
}

export async function plan() {
  const [own, arena, vis] = await Promise.all([account(OWNER), account(ACCOUNT), VISITOR ? account(VISITOR) : Promise.resolve(null)]);
  const out = { network: NETWORK, account: ACCOUNT, board: BOARD, owner: OWNER, owner_free: own ? near(BigInt(own.amount) - BigInt(own.storage_usage) * BYTE) : null, steps: [] };
  let pot = null;
  if (arena && arena.code_hash !== '11111111111111111111111111111111') {
    pot = await view(ACCOUNT, 'get_guardian', { token_id: POT_TOKEN }).catch(() => null);
  }
  if (pot && VISITOR && pot.agent === VISITOR) {
    const unspent = BigInt(pot.pot) - BigInt(pot.spent) - BigInt(pot.reserved);
    out.steps.push({ step: 'repay', to: VISITOR, yocto: String(unspent), near: near(unspent), gas_prepaid_near: near(5n * TG * GAS_PREPAY) });
  }
  if (arena && arena.code_hash === DEP.retired?.['arena.nearcarta.near (v1)']?.code_hash) {
    out.steps.push({ step: 'close', recovers_near: near(arena.amount), deposit_yocto: '1', gas_prepaid_near: near(30n * TG * GAS_PREPAY) });
  }
  const w = wasm();
  const bytes = 100n + BigInt(w.bytes.length) + 45n + STATE_BYTES;
  const stake = bytes * BYTE + SLACK;
  // deploy gas: send + exec per byte (live protocol config), plus create, transfer and the new() call
  const deployGas = 184_765_750_000n * 2n + (47_683_715n + 64_572_944n) * BigInt(w.bytes.length);
  const gas = deployGas + 7_700_000_000_000n + 230_246_125_000n + 80n * TG;
  out.steps.push({ step: 'create', account: ACCOUNT, wasm_bytes: w.bytes.length, wasm_sha256: w.sha, stake_near: near(stake), gas_prepaid_near: near(gas * GAS_PREPAY), caps: CAPS, exists: !!arena });
  out.visitor_free = vis ? near(BigInt(vis.amount) - BigInt(vis.storage_usage) * BYTE) : null;
  out._stake = stake; out._gas = gas; out._w = w; out._pot = pot;
  return out;
}

async function signer(envName, accountId) {
  const key = process.env[envName] || '';
  if (!key.startsWith('ed25519:')) throw new Error(`set ${envName}`);
  const { Account, JsonRpcProvider, KeyPairSigner } = await import('near-api-js');
  return new Account(accountId, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(key));
}
const hashOf = r => r.transaction?.hash || r.transaction_outcome?.id;
const failure = r => r.status?.Failure ? JSON.stringify(r.status.Failure).slice(0, 200) : null;

async function live(step, p) {
  const { actions: A } = await import('near-api-js');
  const owner = await signer('NEAR_MAIN_PRIVATE_KEY', OWNER);
  const send = async (who, receiverId, actions) => {
    const r = await who.signAndSendTransaction({ receiverId, actions, waitUntil: 'FINAL', throwOnFailure: false });
    return { tx: hashOf(r), failure: failure(r) };
  };
  if (step === 'repay') {
    const s = p.steps.find(x => x.step === 'repay'); if (!s) throw new Error('nothing to repay');
    return send(owner, VISITOR, [A.transfer(BigInt(s.yocto))]);
  }
  if (step === 'close') {
    if (!p.steps.find(x => x.step === 'close')) throw new Error('arena v1 is not live');
    return send(owner, ACCOUNT, [A.functionCall('close', {}, 30n * TG, 1n)]);
  }
  if (step === 'create') {
    if (await account(ACCOUNT)) throw new Error(ACCOUNT + ' still exists');
    return send(owner, ACCOUNT, [
      A.createAccount(), A.transfer(p._stake), A.deployContract(new Uint8Array(p._w.bytes)),
      A.functionCall('new', { owner: OWNER, board: BOARD, caps: CAPS }, 80n * TG, 0n),
    ]);
  }
  if (step === 'smoke') {
    if (!VISITOR) throw new Error('the ' + NETWORK + ' record names no stranger for the smoke test (set the record root_funder, or skip the smoke)');
    const stranger = await signer('NEAR_IMPLICIT_PRIVATE_KEY', VISITOR);
    const refused = await send(stranger, ACCOUNT, [A.functionCall('set_caps', { caps: { ...CAPS, city_payout_per_day: String(10n ** 24n) } }, 20n * TG, 0n)]);
    const ok = await send(owner, ACCOUNT, [A.functionCall('set_caps', { caps: CAPS }, 20n * TG, 0n)]);
    return { stranger: refused, owner: ok, config: await view(ACCOUNT, 'get_config') };
  }
  throw new Error('unknown step');
}

if (process.argv[1]?.endsWith('market-deploy.js')) {
  for (const r of net.refusals) console.error('refused: ' + r);
  if (net.refusals.length) process.exit(1);
  console.log('network: ' + NETWORK + '  record: shared/deployments/' + NETWORK + '.json');
  console.log('live command: ' + liveHint('market-deploy.js', NETWORK));
  const p = await plan();
  const { _stake, _gas, _w, _pot, ...shown } = p;
  console.log(JSON.stringify(shown, null, 1));
  const i = process.argv.indexOf('--step');
  if (process.argv.includes('--live') && i > 0) {
    try { console.log(JSON.stringify(await live(process.argv[i + 1], p), null, 1)); }
    catch (e) { console.error('refused: ' + (e instanceof Error ? e.message : 'error')); process.exit(1); }
  }
}
