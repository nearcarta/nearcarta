// Nine keepers: each shop's NPC is a real sub-account of nearcarta.near with a row on the board and a shop on the market.
// Dry by default (prints exact costs). --live --step <keys|accounts|rows|market|smoke> signs one step.
// Keys are written chmod 600 and read back before any NEAR moves. Nothing here prints a secret.
//   NEAR_MAIN_PRIVATE_KEY      nearcarta.near (owner of the market)
//   NEAR_IMPLICIT_PRIVATE_KEY  the held visitor wallet, the stranger in the smoke test
import { existsSync, openSync, writeSync, fsyncSync, closeSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };
import { GOODS, ITEMS, NODES, SHOP_GOODS, TARGET } from '../shared/market/sim.js';
import { openRowTransactions } from '../shared/setup/open-row.js';
import { CALLS_DEPOSIT_YOCTO, SESSION_METHODS } from '../shared/board/session.js';

const RPC = MAIN.rpc, ROOT = MAIN.root, BOARD = MAIN.board.contract, MARKET = MAIN.market.contract, STRANGER = MAIN.root_funder;
const DIR = process.env.KEY_DIR || `${homedir()}/.near-credentials/mainnet`;
const AGENTS = `${DIR}/keeper-agents.json`;
const TG = 10n ** 12n, NEAR = 10n ** 24n, MILLI = 10n ** 21n, BYTE = 10n ** 19n;
export const KEEPERS = Object.keys(SHOP_GOODS).map(shop => ({ shop, account: `keeper-${shop}.${ROOT}` }));
// ONLY=ferry,toll limits a live step to those shops, so NEAR goes out one keeper at a time.
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const picked = r => !ONLY.length || ONLY.includes(r.shop);
// Row: one receiver (the market), restock and invest only, small caps.
export const RULES = {
  receivers: [MARKET], per_action_cap: String(5n * MILLI), daily_budget: String(10n * MILLI), max_actions_per_day: 8,
  window_start_min: 0, window_end_min: 0, min_amount: String(NEAR / 10000n), expires_at: '0',
};
export const CALLS = ['restock', 'invest'].map(method => ({ receiver: MARKET, method, cap: String(5n * MILLI) }));
const ROW_FUND = 5n * MILLI;                       // spendable in the row, for restock
const ROW_DEPOSIT = BigInt(MAIN.board.max_row_yocto); // attached; the board refunds what it does not keep
const CALLS_DEPOSIT = BigInt(CALLS_DEPOSIT_YOCTO);
const GAS_OPEN = 60n * TG, GAS_CALLS = 60n * TG;
const PURSE = 15n * MILLI;                         // left in each keeper's own wallet after the row opens
const ALLOWANCE = 10n * MILLI;                     // gas allowance on the agent key
// Account: 100 B + one full key + one function-call key, generous.
const ACCOUNT_STAKE = 400n * BYTE;
// Shop on the market: till and floor (NEAR), goods priced as in the sim.
export const TILL = 10n * MILLI, FLOOR = 3n * MILLI;

const near = y => { const v = BigInt(y); const s = v < 0n ? '-' : ''; const a = v < 0n ? -v : v; return s + (a / NEAR) + '.' + (a % NEAR).toString().padStart(24, '0').slice(0, 6); };
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(x => x.json());
  if (r.error) throw Object.assign(new Error(r.error.cause?.name || r.error.message), { rpc: r.error });
  return r.result;
}
const account = id => rpc('query', { request_type: 'view_account', finality: 'final', account_id: id }).catch(() => null);
const view = (id, method, args = {}) => rpc('query', { request_type: 'call_function', finality: 'final', account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') })
  .then(r => JSON.parse(Buffer.from(r.result).toString() || 'null')).catch(() => undefined);
const free = a => a ? BigInt(a.amount) - BigInt(a.storage_usage) * BYTE : 0n;

function writeOnce(file, obj) {
  const fd = openSync(file, 'wx', 0o600); writeSync(fd, JSON.stringify(obj)); fsyncSync(fd); closeSync(fd);
  const back = JSON.parse(readFileSync(file, 'utf8'));
  if (JSON.stringify(back) !== JSON.stringify(obj)) throw new Error('read-back mismatch: ' + file);
}
function checkMode(file) { if ((statSync(file).mode & 0o077) !== 0) throw new Error(file + ' must be chmod 600'); }
async function keys(mint) {
  const { KeyPair } = await import('near-api-js');
  const out = {};
  let agents = existsSync(AGENTS) ? (checkMode(AGENTS), JSON.parse(readFileSync(AGENTS, 'utf8'))) : null;
  if (!agents && mint) {
    agents = Object.fromEntries(KEEPERS.map(k => { const kp = KeyPair.fromRandom('ed25519'); return [k.account, { public_key: kp.getPublicKey().toString(), private_key: kp.toString() }]; }));
    writeOnce(AGENTS, agents);
  }
  for (const k of KEEPERS) {
    const f = `${DIR}/${k.account}.json`;
    if (!existsSync(f) && mint) { const kp = KeyPair.fromRandom('ed25519'); writeOnce(f, { account_id: k.account, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }); }
    if (existsSync(f)) { checkMode(f); const j = JSON.parse(readFileSync(f, 'utf8')); out[k.account] = { pub: j.public_key, secret: j.private_key, agentPub: agents?.[k.account]?.public_key }; }
  }
  return out;
}

export async function plan() {
  const gasPrice = BigInt((await rpc('gas_price', [null])).gas_price);
  // Attached gas is bought at max(gas price, 10^9 yocto) while in flight; the unused part comes back.
  const buy = gasPrice > 10n ** 9n ? gasPrice : 10n ** 9n;
  const sendNeed = ROW_DEPOSIT + CALLS_DEPOSIT + (GAS_OPEN + GAS_CALLS + 10n * TG) * buy;
  const fund = ACCOUNT_STAKE + sendNeed + PURSE;
  const rows = [];
  const board = await view(MARKET, 'market_board');
  for (const k of KEEPERS) {
    const [a, row] = await Promise.all([account(k.account), view(BOARD, 'get_charter', { owner: k.account })]);
    rows.push({ ...k, exists: !!a, free: a ? near(free(a)) : null, row: !!row, has_shop: Array.isArray(board) ? board.some(s => s.id === k.shop) : '?' });
  }
  const toCreate = rows.filter(r => !r.exists).length;
  const own = await account(ROOT), mkt = await account(MARKET);
  return {
    gas_price: String(gasPrice), owner_free: near(free(own)), market_free: near(free(mkt)),
    per_keeper: { create_charge: '0.007000', fund: near(fund), send_needs: near(sendNeed), purse_after: near(PURSE), row_keeps_estimate: '~0.025 (storage, refundable) + 0.005 fund' },
    accounts_to_create: toCreate, owner_out_for_accounts: near(BigInt(toCreate) * (fund + 7n * MILLI)),
    shop_tills: near(TILL * BigInt(KEEPERS.length)), rows, _fund: fund, _gasPrice: gasPrice,
  };
}

async function acc(id, secret) {
  const { Account, JsonRpcProvider, KeyPairSigner } = await import('near-api-js');
  return new Account(id, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(secret));
}
const hashOf = r => r.transaction?.hash || r.transaction_outcome?.id;
const fail = r => { for (const o of [r.transaction_outcome, ...(r.receipts_outcome || [])]) { const f = o?.outcome?.status?.Failure; if (f) return JSON.stringify(f).slice(0, 220); } return null; };
async function send(who, receiverId, actions) { const r = await who.signAndSendTransaction({ receiverId, actions, waitUntil: 'FINAL', throwOnFailure: false }); return { tx: hashOf(r), failure: fail(r) }; }
const ownerKey = () => { const k = process.env.NEAR_MAIN_PRIVATE_KEY || ''; if (!k.startsWith('ed25519:')) throw new Error('set NEAR_MAIN_PRIVATE_KEY'); return k; };

async function live(step, p) {
  const { actions: A, KeyPair, PublicKey } = await import('near-api-js');
  const out = [];
  if (step === 'keys') { const k = await keys(true); return Object.entries(k).map(([id, v]) => ({ id, key_saved: !!v.secret, agent_saved: !!v.agentPub })); }
  const K = await keys(false);
  if (step === 'accounts') {
    const owner = await acc(ROOT, ownerKey());
    for (const r of p.rows) {
      if (r.exists) continue;
      if (!picked(r)) continue;
      const k = K[r.account]; if (!k?.secret || !k.agentPub) throw new Error('keys missing for ' + r.account + ': run --step keys first');
      const res = await send(owner, r.account, [A.createAccount(), A.transfer(p._fund), A.addFullAccessKey(KeyPair.fromString(k.secret).getPublicKey())]);
      out.push({ step: 'create', account: r.account, near: near(p._fund), ...res }); if (res.failure) break;
    }
  }
  if (step === 'rows') {
    for (const r of p.rows) {
      if (r.row || !r.exists) continue;
      if (!picked(r)) continue;
      const k = K[r.account]; const keeper = await acc(r.account, k.secret);
      const { open } = openRowTransactions({ accountId: r.account, contract: BOARD, rules: RULES, agentPublicKey: k.agentPub, fundYocto: String(ROW_FUND),
        rowDepositYocto: String(ROW_DEPOSIT), callsDepositYocto: String(CALLS_DEPOSIT), calls: CALLS, effects: [], gasOpen: String(GAS_OPEN), gasAgent: String(GAS_CALLS),
        methodNames: SESSION_METHODS, allowance: String(ALLOWANCE) });
      // The agent key is a function-call key on the keeper's own account, board only, gas allowance only.
      const fc = await send(keeper, r.account, [A.addFunctionCallAccessKey(PublicKey.from(k.agentPub), BOARD, [...SESSION_METHODS], ALLOWANCE)]);
      out.push({ step: 'agent_key', account: r.account, ...fc }); if (fc.failure) break;
      const o = await send(keeper, open.receiverId, open.actions.map(a => A.functionCall(a.params.methodName, a.params.args, BigInt(a.params.gas), BigInt(a.params.deposit))));
      out.push({ step: 'row', account: r.account, ...o }); if (o.failure) break;
      // Leave PURSE in the keeper's wallet; the rest of the send float goes back to the owner.
      const a = await account(r.account); const extra = free(a) - PURSE;
      if (extra > MILLI) { const s = await send(keeper, ROOT, [A.transfer(extra)]); out.push({ step: 'sweep', account: r.account, near: near(extra), ...s }); if (s.failure) break; }
    }
  }
  if (step === 'market') {
    const owner = await acc(ROOT, ownerKey());
    const tokens = { ...Object.fromEntries(Object.entries(GOODS).map(([id, g]) => [id, { title: g.name, description: `${g.name}, a trade good of Nearcarta.`, kind: 'good', icon: g.icon }])),
      ...Object.fromEntries(Object.entries(ITEMS).map(([id, g]) => [id, { title: g.name, description: g.use, kind: 'item', icon: null }])) };
    const have = await view(MARKET, 'mt_token', { token_ids: Object.keys(tokens) }) || [];
    const reg = Object.entries(tokens).filter((_, i) => !have[i]).map(([id, meta]) => A.functionCall('register_token', { token_id: id, meta }, 10n * TG, 0n));
    if (reg.length && process.env.SKIP_SETUP !== '1') out.push({ step: 'register_tokens', n: reg.length, ...(await send(owner, MARKET, reg)) });
    if (process.env.SKIP_SETUP !== '1') out.push({ step: 'set_nodes', n: NODES.length, ...(await send(owner, MARKET, NODES.map(([node, good]) => A.functionCall('set_node', { node, good }, 10n * TG, 0n)))) });
    for (const r of p.rows) {
      if (r.has_shop === true) continue;
      if (!picked(r)) continue;
      const goods = SHOP_GOODS[r.shop].map(g => ({ good: g, base: String(GOODS[g].base), target: String(TARGET) }));
      const acts = [A.functionCall('open_shop', { id: r.shop, keeper: r.account, floor: String(FLOOR), goods }, 30n * TG, TILL),
        ...SHOP_GOODS[r.shop].map(g => A.functionCall('stock_shop', { shop: r.shop, good: g, qty: String(TARGET) }, 20n * TG, 0n))];
      const res = await send(owner, MARKET, acts); out.push({ step: 'open_shop', shop: r.shop, keeper: r.account, till: near(TILL), ...res }); if (res.failure) break;
    }
  }
  if (step === 'smoke') {
    const owner = await acc(ROOT, ownerKey());
    const stranger = await acc(STRANGER, process.env.NEAR_IMPLICIT_PRIVATE_KEY || '');
    const k0 = KEEPERS[0];
    out.push({ step: 'stranger_open_shop', expect: 'ERR_OWNER', ...(await send(stranger, MARKET, [A.functionCall('open_shop', { id: 'fake', keeper: STRANGER, floor: '1', goods: [] }, 20n * TG, 0n)])) });
    out.push({ step: 'stranger_keeper_take', expect: 'ERR_NOT_KEEPER', ...(await send(stranger, MARKET, [A.functionCall('keeper_take', { shop: k0.shop, amount: String(MILLI) }, 20n * TG, 0n)])) });
    out.push({ step: 'stranger_force_close_keeper_row', expect: 'ERR_NOT_OWNER or full-key refusal', ...(await send(stranger, BOARD, [A.functionCall('force_close', { visitor: k0.account }, 30n * TG, 1n)])) });
    out.push({ step: 'owner_stock_shop', expect: 'ok', ...(await send(owner, MARKET, [A.functionCall('stock_shop', { shop: k0.shop, good: SHOP_GOODS[k0.shop][0], qty: '1' }, 20n * TG, 0n)])) });
  }
  return out;
}
export { live, keys };

if (process.argv[1]?.endsWith('keepers-deploy.js')) {
  const p = await plan();
  const { _fund, _gasPrice, ...shown } = p;
  console.log(JSON.stringify(shown, null, 1));
  const i = process.argv.indexOf('--step');
  if (process.argv.includes('--live') && i > 0) {
    try { console.log(JSON.stringify(await live(process.argv[i + 1], p), null, 1)); }
    catch (e) { console.error('refused: ' + (e instanceof Error ? e.message : 'error')); process.exit(1); }
  }
}
