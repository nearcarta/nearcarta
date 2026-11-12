#!/usr/bin/env node
// Read-only check of one visitor's Ferry row path on mainnet. It signs nothing and sends nothing.
//
// Reads the live board row (get_charter), the row's call policy (view_state on the board),
// wrap.near storage for the board, and the visitor's board access keys, then plans a wNEAR→USDC
// swap with the same depositPlan/rowFit the city uses and replays the board's propose_call checks
// (contracts/charter_board/src/lib.rs) step by step, as if the /setup rules update had landed:
// min_amount 1 yocto, wrap.near in receivers, and the daily budget given with --daily.
// The live `simulate` view is asked too, so the output shows today's chain answer beside the replay.
//
// Usage: node backend/scripts/ferry-row-simulate.js <account> [--amount 0.003] [--daily 0.02] [--fund 0.003]
import { depositPlan, rowFit, stepsAllowanceYocto, WRAP } from '../../app/src/panels/ferry-settle.js';

const args = process.argv.slice(2);
const owner = args.find(a => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
if (!owner) { console.error('usage: ferry-row-simulate.js <account> [--amount 0.003] [--daily 0.02] [--fund 0]'); process.exit(2); }
const BOARD = opt('board', 'board.nearcarta.near');
const RPCS = (process.env.NEAR_RPC || 'https://rpc.mainnet.near.org,https://free.rpc.fastnear.com,https://near.lava.build').split(',');
const Y = n => (BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n);
const N = y => (Number(BigInt(y) / 10n ** 15n) / 1e9).toFixed(6);

async function rpc(params, method = 'query') {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json();
      if (j.error) { last = new Error(JSON.stringify(j.error).slice(0, 200)); continue; }
      return j.result;
    } catch (e) { last = e; }
  }
  throw last;
}
async function view(account, method, a) {
  const r = await rpc({ request_type: 'call_function', finality: 'final', account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') });
  return JSON.parse(Buffer.from(r.result).toString() || 'null');
}
// The board stores one row's call policy under b"c" + borsh(String owner); see encode_calls.
async function callPolicyOf(id) {
  const key = Buffer.concat([Buffer.from('c'), Buffer.from(Uint32Array.of(id.length).buffer), Buffer.from(id)]);
  const r = await rpc({ request_type: 'view_state', finality: 'final', account_id: BOARD, prefix_base64: key.toString('base64') });
  const v = r.values?.[0];
  if (!v) return null;
  let b = Buffer.from(v.value, 'base64');
  if (b.readUInt32LE(0) === b.length - 4) b = b.subarray(4);
  let i = 0;
  const u32 = () => { const x = b.readUInt32LE(i); i += 4; return x; };
  const str = () => { const n = u32(); const s = b.subarray(i, i + n).toString(); i += n; return s; };
  const u128 = () => { let x = 0n; for (let k = 15; k >= 0; k--) x = (x << 8n) | BigInt(b[i + k]); i += 16; return x; };
  u32();
  str();
  const rules = [];
  for (let n = u32(); n > 0; n--) rules.push({ receiver: str(), method: str(), cap: u128() });
  return { rules, session_cap: u128(), session_spent: u128() };
}

const amount = opt('amount', '0.003');
const daily = opt('daily', null);
const fund = opt('fund', '0');
const row = await view(BOARD, 'get_charter', { owner });
if (!row) { console.log(JSON.stringify({ owner, ok: false, reason: 'no_row' })); process.exit(1); }
const policy = await callPolicyOf(owner);
const wrapStorage = await view(WRAP, 'storage_balance_of', { account_id: BOARD });
const boardWnear = await view(WRAP, 'ft_balance_of', { account_id: BOARD });
const keys = await rpc({ request_type: 'view_access_key_list', finality: 'final', account_id: owner });
const boardKey = (keys.keys || []).find(k => k.access_key?.permission?.FunctionCall?.receiver_id === BOARD);
const allowance = boardKey?.access_key?.permission?.FunctionCall?.allowance ?? null;

// The row as if /setup's Update my rules (and an optional fund) had landed.
const after = {
  ...row,
  min_amount: '1',
  receivers: row.receivers.includes(WRAP) ? row.receivers : [...row.receivers, WRAP],
  daily_budget: daily ? Y(daily).toString() : row.daily_budget,
  balance: (BigInt(row.balance) + Y(fund)).toString(),
};
const sessionCap = daily ? Y(daily) : policy?.session_cap ?? 0n; // set_calls writes session_cap = daily
const plan = depositPlan({
  from: 'wNEAR@near', amount, depositAddress: 'f'.repeat(64), wrapRegistered: !!wrapStorage,
  depositAccountRegistered: false, row: after,
});
const steps = plan.steps.length ? plan.steps : depositPlan({ from: 'wNEAR@near', amount, depositAddress: 'f'.repeat(64), wrapRegistered: !!wrapStorage, depositAccountRegistered: false }).steps;

// Replay lib.rs propose_call for each step, carrying spent/count/balance/session forward.
let spent = BigInt(after.spent_today), count = Number(after.actions_today), bal = BigInt(after.balance), sess = policy?.session_spent ?? 0n;
const replay = [];
for (const s of steps) {
  const d = BigInt(s.deposit);
  const rule = policy?.rules.find(r => r.receiver === s.receiver && r.method === s.method);
  const why = d < BigInt(after.min_amount) ? 'below_min_amount'
    : !after.receivers.includes(s.receiver) ? 'receiver_not_allowlisted'
    : !rule ? 'method_not_allowlisted'
    : d > rule.cap ? 'over_shop_cap'
    : sess + d > sessionCap ? 'over_session_cap'
    : d > BigInt(after.per_action_cap) ? 'over_per_action_cap'
    : spent + d > BigInt(after.daily_budget) ? 'over_daily_budget'
    : count >= Number(after.max_actions_per_day) ? 'over_daily_action_count'
    : bal < d ? 'ERR_BALANCE' : 'allowed';
  const live = await view(BOARD, 'simulate', { owner, receiver: s.receiver, method: s.method, deposit: s.deposit, effects: [] }).then(x => (typeof x === 'string' ? JSON.parse(x) : x)).catch(e => ({ error: String(e.message || e).slice(0, 120) }));
  replay.push({ method: s.method, deposit_near: N(s.deposit), deposit_yocto: s.deposit, after_update: why, live_now: live.reason || live.error });
  if (why !== 'allowed') break;
  spent += d; count += 1; bal -= d; sess += d;
}
const fit = rowFit(steps, after);
const out = {
  owner, board: BOARD, signed: false, amount,
  row_now: { receivers: row.receivers, per_action_cap: N(row.per_action_cap), daily_budget: N(row.daily_budget), spent_today: N(row.spent_today), actions_today: row.actions_today, max_actions_per_day: row.max_actions_per_day, min_amount_yocto: row.min_amount, balance: N(row.balance), expires_at: row.expires_at },
  session: policy ? { cap: N(policy.session_cap), spent: N(policy.session_spent), cap_after_update: N(sessionCap), pairs: policy.rules.length, wrap_pairs: policy.rules.filter(r => r.receiver === WRAP).map(r => `${r.method}@${N(r.cap)}`) } : null,
  board_wrap: { registered: !!wrapStorage, shared_wnear: N(boardWnear) },
  agent_key: { allowance: allowance == null ? 'unlimited or none' : N(allowance), needs: N(stepsAllowanceYocto(steps)), ok: allowance == null || BigInt(allowance) >= stepsAllowanceYocto(steps), methods: boardKey?.access_key?.permission?.FunctionCall?.method_names || [] },
  assumed_update: { min_amount: '1', add_receiver: !row.receivers.includes(WRAP) ? WRAP : null, daily_budget: N(after.daily_budget), fund: fund },
  plan: { kind: plan.kind, need_near: N(steps.reduce((n, s) => n + BigInt(s.deposit), 0n)), steps: steps.map(s => `${s.method} ${N(s.deposit)}`), row_fit: fit.ok ? 'ok' : `${fit.reason}: ${fit.text}` },
  replay,
  rules_ok: replay.length === steps.length && replay.every(r => r.after_update === 'allowed') && fit.ok,
};
out.gas_ok = out.agent_key.ok;
out.ok = out.rules_ok && out.gas_ok;
if (!out.gas_ok) out.next = 'Refresh agent key in /setup first: the key cannot prepay every step of this swap.';
console.log(JSON.stringify(out, null, 2));
process.exit(out.rules_ok ? 0 : 1);
