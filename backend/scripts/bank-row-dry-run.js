// Dry run for the two Board v2 methods Mist Bank now sends from the city:
//   tighten_rules   the visitor's own row cap, shrink-only
//   anchor          the opt-in salted commitment (hashes salt || digest, stores neither)
//
// This script never signs and never writes. It reads the deployed board with the visitor
// account you pass in, prints exactly what the page would send, and checks the answer
// against the contract's own rules, so you can see the shape before a click.
//
//   node backend/scripts/bank-row-dry-run.js --account <visitor.near> [--after 0.005]
//   node backend/scripts/bank-row-dry-run.js --account <visitor.near> --json
//
// Contract: contracts/charter_board/src/v2.rs (tighten_rules, anchor)
// Session scope: shared/board/session.js
import { createHash } from 'node:crypto';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };
import { SESSION_METHODS } from '../../shared/board/session.js';
import { rpcClient } from '../../shared/vault/tx.js';
import { rulesInFromRow, nearOfYocto } from '../../app/src/panels/bank-board.js';

const arg = name => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const json = process.argv.includes('--json');
const account = String(arg('account') || '').trim();
const afterNear = arg('after');

// Any NEAR account id the board could key a row by, named or implicit.
if (account.length < 2 || account.length > 100 || !/^[a-z0-9][a-z0-9._-]*$/.test(account)) {
  console.error('Pass --account <visitor.near>. This script reads that account\'s own row.');
  process.exit(1);
}

const BOARD = MAIN.board?.contract;
if (!BOARD || MAIN.board?.status !== 'deployed') {
  console.error('mainnet.json board.contract is not deployed');
  process.exit(1);
}

const rpc = rpcClient([MAIN.rpc, ...(MAIN.rpc_fallbacks || [])]);
const view = async (method, args) => {
  const out = await rpc('query', {
    request_type: 'call_function', finality: 'final', account_id: BOARD, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  const raw = Buffer.from(out?.result || []).toString('utf8');
  return raw ? JSON.parse(raw) : null;
};

const row = await view('get_charter', { owner: account });
if (!row) {
  console.log('This account has no row on the board, so there is nothing to tighten or anchor.');
  console.log('The city page says the same and signs nothing.');
  process.exit(0);
}

const rules = rulesInFromRow(row);
if (!rules) {
  console.error('The board returned a row with no numeric per-payment cap; nothing to plan.');
  process.exit(1);
}
const beforeYocto = BigInt(rules.per_action_cap);
const targetNear = afterNear != null ? Number(afterNear) : nearOfYocto(beforeYocto) / 2;
const targetYocto = (BigInt(Math.round(targetNear * 1e6)) * 10n ** 24n) / 1_000_000n;
const shrinkOk = targetYocto > 0n && targetYocto < beforeYocto;
const dailyOk = BigInt(rules.daily_budget) >= targetYocto;
const minOk = BigInt(rules.min_amount) <= targetYocto;

const tightenArgs = { rules: { ...rules, per_action_cap: targetYocto.toString() }, freeze: false };
// The page's saltFor() makes 16 lowercase letters and digits; this is the same shape.
const salt = createHash('sha256').update(`${account}|dry-run`).digest('hex').slice(0, 16);
const digest = createHash('sha256').update(`bank-audit-v1|dry-run|${nearOfYocto(targetYocto)}|${salt}`).digest('hex');
const anchorArgs = { kind: 'bank_cap', digest, salt };

const plan = {
  account,
  board: BOARD,
  row: {
    per_action_cap: nearOfYocto(beforeYocto),
    daily_budget: nearOfYocto(row.daily_budget),
    min_amount: nearOfYocto(row.min_amount),
    max_actions_per_day: row.max_actions_per_day,
    receivers: row.receivers,
    expires_at: row.expires_at,
    frozen: row.frozen,
    nonce: row.nonce,
    agent: row.agent,
  },
  tighten: {
    method: 'tighten_rules',
    signed_by: 'the session key in the visitor browser (no wallet, no popup)',
    session_key_may_call: SESSION_METHODS.includes('tighten_rules'),
    before_near: nearOfYocto(beforeYocto),
    after_near: nearOfYocto(targetYocto),
    contract_would_accept: shrinkOk && dailyOk && minOk,
    refuses_because: shrinkOk ? (dailyOk ? (minOk ? null : 'min_amount is above the new cap') : 'daily_budget is below the new cap') : 'the new cap is not strictly lower',
    args: tightenArgs,
    gas_tgas: 30,
  },
  anchor: {
    method: 'anchor',
    signed_by: 'the same session key, only after tighten_rules is FINAL and the visitor ticked consent',
    session_key_may_call: SESSION_METHODS.includes('anchor'),
    note: 'The board hashes salt || digest and stores neither. The statement is never in this call.',
    args: anchorArgs,
    gas_tgas: 20,
  },
  signed_by_this_script: false,
};

if (json) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}
const n = v => (typeof v === 'number' ? v.toFixed(6) : v);
console.log(`Board: ${BOARD}`);
console.log(`Visitor: ${account}`);
console.log(`Row now: cap ${n(plan.row.per_action_cap)} NEAR, daily ${n(plan.row.daily_budget)} NEAR, min ${n(plan.row.min_amount)} NEAR, ${plan.row.max_actions_per_day}/day, nonce ${plan.row.nonce}`);
console.log(`Receivers: ${plan.row.receivers.join(', ') || '(none listed)'}`);
console.log('');
console.log(`tighten_rules  ${n(plan.tighten.before_near)} -> ${n(plan.tighten.after_near)} NEAR`);
console.log(`  session key may call it: ${plan.tighten.session_key_may_call}`);
console.log(`  the contract would accept it: ${plan.tighten.contract_would_accept}${plan.tighten.refuses_because ? ` (${plan.tighten.refuses_because})` : ''}`);
console.log(`  args: ${JSON.stringify(tightenArgs)}`);
console.log('');
console.log('anchor (opt-in, after the tighten is final)');
console.log(`  session key may call it: ${plan.anchor.session_key_may_call}`);
console.log(`  args: ${JSON.stringify(anchorArgs)}`);
console.log('  the board stores neither the digest nor the salt; it logs one hash of salt || digest');
console.log('');
console.log('This script signed nothing. The city page sends these two calls.');
