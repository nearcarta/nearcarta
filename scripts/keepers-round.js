// One keepers' round on mainnet, from the box. Every move is decided by a verified NEAR AI completion
// (backend/src/keepers.js); a move without a verified signature is not sent.
//   node scripts/keepers-round.js restock <shop>                    dry: the decision and the exact cost
//   node scripts/keepers-round.js restock <shop> --live             send it through the keeper's board row
//   node scripts/keepers-round.js propose <shop> <rule> <value> "<why>" [--live]
//   node scripts/keepers-round.js vote <shop> [--why "<reason given>"] [--live]
// restock: propose_call_as signed by the row's agent key. Anyone may submit it (the signature is the
// authority), so the city account sends it and pays the gas; the keeper's row pays the stock.
// council: a direct market call by the keeper, signed with its account key.
// Keys come from KEY_DIR (chmod 600 files) and are never printed. Stops when a cost runs >10% over.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };
import { decideRestock, decideVote, restockCall } from '../backend/src/keepers.js';
import { checkRule } from '../shared/market/keeper-ai.js';
const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
const { callAsMessage } = await import('../shared/board/call-as.js');
const { keyFrom, signMessage } = await import('../shared/vault/tx.js');

const RPC = MAIN.rpc, BOARD = MAIN.board.contract, MARKET = MAIN.market.contract, ROOT = MAIN.root;
const DIR = process.env.KEY_DIR || `${homedir()}/.near-credentials/mainnet`;
const TG = 10n ** 12n;
const provider = new JsonRpcProvider({ url: RPC });
const secretFile = (p) => { if ((statSync(p).mode & 0o077) !== 0) throw new Error(`${p} is not chmod 600`); return JSON.parse(readFileSync(p, 'utf8')); };
const agentOf = (acct) => secretFile(`${DIR}/keeper-agents.json`)[acct];
const keeperKey = (acct) => secretFile(`${DIR}/${acct}.json`).private_key;
const view = async (c, m, a = {}) => provider.callFunction({ contractId: c, method: m, args: a, blockQuery: { finality: 'final' } });
const bal = async (a) => BigInt((await provider.viewAccount({ accountId: a, blockQuery: { finality: 'final' } })).amount);
const near = (y) => (Number(y) / 1e24).toFixed(6);

async function costCheck(gas, deposit) {
  const { gas_price } = await provider.viewGasPrice(null);
  const g = BigInt(gas_price) > 10n ** 9n ? BigInt(gas_price) : 10n ** 9n; // prepaid at the higher of the two
  return { worst: gas * g + BigInt(deposit), price: gas_price };
}
async function send(acct, signerKey, receiver, actions, estimate) {
  const before = await bal(acct);
  const a = new Account(acct, provider, KeyPairSigner.fromSecretKey(signerKey));
  const r = await a.signAndSendTransaction({ receiverId: receiver, actions, waitUntil: 'FINAL', throwOnFailure: false });
  const after = await bal(acct);
  const fail = [r.status?.Failure, ...(r.receipts_outcome || []).map((o) => o.outcome?.status?.Failure)].find(Boolean);
  const spent = before - after;
  return { hash: r.transaction?.hash, ok: !fail, failure: fail ? JSON.stringify(fail).slice(0, 240) : null, spent_near: near(spent), estimate_near: near(estimate), over: spent > (estimate * 11n) / 10n };
}

const [cmd, shop, ...rest] = process.argv.slice(2);
const live = process.argv.includes('--live');
const acct = `keeper-${shop}.${ROOT}`;
const out = { cmd, shop, keeper: acct, live };

if (cmd === 'restock') {
  const board = await view(MARKET, 'market_board');
  const d = await decideRestock(shop, board);
  out.decision = { completion_id: d.completion_id || null, reply: d.reply, why: d.why || null, verified: d.proof?.verified || false, verify_url: d.proof?.verify_url || null };
  if (d.reply) {
    const call = restockCall(shop, d.reply, d.completion_id);
    const row = await view(BOARD, 'get_charter', { owner: acct });
    if (BigInt(call.deposit) > BigInt(row.per_action_cap)) throw new Error('restock is over the row cap per action');
    const expiry = BigInt(Date.now()) * 1_000_000n + 600_000_000_000n;
    // The row's epoch has no view of its own: read the board's own text for this call, take the epoch
    // from it, rebuild the text here and sign only if both agree.
    const base = { owner: acct, receiver: MARKET, method: call.method, args: call.args, deposit: call.deposit, nonce: String(row.nonce), expiry: String(expiry), effects: [], hold: false };
    const onChain = await view(BOARD, 'call_as_message', base);
    const epoch = onChain.split('|')[11];
    const msg = callAsMessage({ network: 'mainnet', contract: BOARD, ...base, epoch });
    if (msg !== onChain) throw new Error('call text differs from the board');
    const agent = keyFrom(agentOf(acct).private_key);
    const signature = signMessage(agent, msg);
    const gas = 100n * TG; const c = await costCheck(gas, 0n);
    out.call = { ...call, row_nonce: row.nonce, epoch, gas: '100 Tgas', submitter: ROOT, worst_gas_near: near(c.worst), paid_from_row_near: near(call.deposit) };
    if (live) out.tx = await send(ROOT, process.env.NEAR_MAIN_PRIVATE_KEY, BOARD, [A.functionCall('propose_call_as', { owner: acct, receiver: MARKET, method: call.method, args: call.args, deposit: call.deposit, expiry: String(expiry), effects: [], hold: false, signature }, gas, 0n)], c.worst);
  }
} else if (cmd === 'propose' || cmd === 'vote') {
  // The keeper sees the rule's effect on its own shop in plain numbers (base floor = effective / bps).
  async function ruleCtx(shop, sq) {
    const me = (await view(MARKET, 'market_board')).find((x) => x.id === shop);
    const floor = me ? (BigInt(me.floor) * 10000n) / BigInt(sq.rules.floor_bps) : undefined;
    return { rules: sq.rules, floor: floor?.toString() };
  }
  const sq = await view(MARKET, 'square', {});
  let msg;
  if (cmd === 'propose') {
    const [rule, value, why] = rest.filter((x) => x !== '--live');
    if (!checkRule(rule, value)) throw new Error('rule out of range');
    const d = await decideVote(shop, { rule, value, why, ...(await ruleCtx(shop, sq)) });
    out.decision = { completion_id: d.completion_id || null, reply: d.reply, why: d.why || null, verified: d.proof?.verified || false, verify_url: d.proof?.verify_url || null };
    if (d.reply?.yes) msg = { yes: true, rule, value: String(value), decision: d.completion_id };
  } else {
    const p = sq.council.open; if (!p) throw new Error('no open proposal');
    const wi = rest.indexOf('--why'); const why = wi >= 0 ? rest[wi + 1] : '';
    const d = await decideVote(shop, { rule: p.rule, value: p.value, why, ...(await ruleCtx(shop, sq)) });
    out.decision = { completion_id: d.completion_id || null, reply: d.reply, why: d.why || null, verified: d.proof?.verified || false, verify_url: d.proof?.verify_url || null };
    if (d.reply) msg = { yes: d.reply.yes, decision: d.completion_id };
  }
  if (msg) {
    const gas = 10n * TG; const c = await costCheck(gas, 0n);
    out.call = { method: 'council', args: msg, worst_gas_near: near(c.worst) };
    if (live) out.tx = await send(acct, keeperKey(acct), MARKET, [A.functionCall('council', msg, gas, 0n)], c.worst);
  }
} else throw new Error('usage: restock|propose|vote <shop> ...');
console.log(JSON.stringify(out, null, 1));
if (out.tx?.over) { console.error('cost ran more than 10% over the estimate: stopping'); process.exit(2); }
