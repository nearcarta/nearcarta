// Open ONE visitor row with a CALLS allowlist, the same shape /setup writes. Dry run by default.
//
//   node backend/scripts/board-fresh-row.js                 plan: reuse the test wallet we hold a key for
//   node backend/scripts/board-fresh-row.js --new           plan: mint a brand new implicit account
//   node backend/scripts/board-fresh-row.js --apply [--new] sign and send
//
// Thrift rules this script enforces, because an earlier version broke all three:
//  1. Keys are written to a chmod-600 file (KEYFILE, default .secrets/fresh-row-keys.json, git
//     ignored) and read back BEFORE any NEAR moves. The file is never overwritten; a second run
//     reuses the same keys, so a crash after funding never strands the account.
//  2. Reuse first. The default visitor is NEAR_IMPLICIT_ACCOUNT, whose key is already in the env:
//     its old row is closed (the board refunds storage and balance to it) and reopened. No new
//     NEAR leaves the owner account in that mode.
//  3. Rules are checked locally against the board's own require! lines before signing:
//     window 0/0 (both < 1440), 0 < min_amount <= per_action_cap, calls as {receiver, method, cap}
//     objects (the live build answers ERR_ARGS to [receiver, method, cap] tuples). The cost is
//     computed from the chain (gas price, balances) and the funding is the exact sum, not a guess.
// It never prints a key.
import { existsSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import { openRowTransactions } from '../../shared/setup/open-row.js';
import { CALLS_DEPOSIT_YOCTO } from '../../shared/board/session.js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

const apply = process.argv.includes('--apply');
const fresh = process.argv.includes('--new');
const board = MAIN.board?.contract || '';
const root = MAIN.root || '';
const rpc = MAIN.rpc || 'https://free.rpc.fastnear.com';
const KEYFILE = process.env.KEYFILE || '.secrets/fresh-row-keys.json';
const TG = 10n ** 12n;
const NEAR = 10n ** 24n;
const BYTE = 10n ** 19n;              // storage price per byte
const ACCOUNT_BYTES = 182n;           // a bare implicit account with one full-access key

// Every shop that sends a contract call through the board, with tiny caps (contracts/charter_board
// a_row_with_every_board_shop_fits_the_row_cap measures this exact row):
//   Town Hall  every lifecycle step (the visitor can post or work a job)
//   Arena fund, House check-in + prepare-send, Toll cross, Guard pay
//   Ferry      wrap.near near_deposit / ft_transfer / storage_deposit and the board's own stamp
//   Payouts    a NEAR payee (nearcarta.near here) by plain propose, the wrap.near pairs for a
//              foreign invoice, and the native-USDC storage_deposit sponsor
//   Bank       anchor and tighten_rules are board methods on the row itself, no pair needed
//   Chronicle  reads only
// The 1Click leg of Ferry/Payouts happens after the board: the row caps the wNEAR the board
// deposits, and the intent can only spend what that deposit put there.
const TH = 'townhall.nearcarta.near';
const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const CAP = NEAR / 1000n;                // 0.001 per call
const PAIRS = [
  ...['post_job', 'bid', 'counter', 'accept', 'deliver', 'review', 'refund'].map(m => [TH, m]),
  ['arena.nearcarta.near', 'fund'],
  ['house.nearcarta.near', 'house_session_check_in'], ['house.nearcarta.near', 'house_session_prepare_send'],
  ['toll.nearcarta.near', 'cross'], ['guard.nearcarta.near', 'pay'],
  ['wrap.near', 'near_deposit'], ['wrap.near', 'ft_transfer'], ['wrap.near', 'storage_deposit'],
  [USDC, 'storage_deposit'], ['board.nearcarta.near', 'stamp'],
];
// The live board (max_row 0.03) cannot hold every pair: 8 receivers / 17 pairs locks 3423 B.
// Until the 0.04 build is live, keep one pair per shop plus the poster's Hall steps and the
// Ferry pair (2958 B in the same unit test with this list). The worker-side Hall steps, House
// prepare-send, wrap storage_deposit, the USDC sponsor and the NEAR payee wait for the 0.04 row.
const LIVE_FIT = new Set(['post_job', 'accept', 'review', 'refund', 'fund', 'house_session_check_in', 'cross', 'pay', 'near_deposit', 'ft_transfer', 'stamp']);
const FULL = BigInt(MAIN.board?.max_row_yocto || 0) >= 40_000_000_000_000_000_000_000n;
const PLAN = FULL ? PAIRS : PAIRS.filter(([r, m]) => LIVE_FIT.has(m) && r !== USDC);
const CALLS = PLAN.map(([receiver, method]) => ({ receiver, method, cap: String(CAP) }));
const RULES = {
  receivers: FULL
    ? [TH, 'arena.nearcarta.near', 'house.nearcarta.near', 'toll.nearcarta.near', 'guard.nearcarta.near', 'wrap.near', USDC, 'nearcarta.near']
    : [TH, 'arena.nearcarta.near', 'house.nearcarta.near', 'toll.nearcarta.near', 'guard.nearcarta.near', 'wrap.near'],
  per_action_cap: String(CAP),           // 0.001
  daily_budget: String(NEAR / 100n),     // 0.01
  max_actions_per_day: 8,
  window_start_min: 0,                   // 0/0 = always open, what /setup sends
  window_end_min: 0,
  min_amount: String(NEAR / 10000n),     // 0.0001, what /setup sends; the board refuses 0 (ERR_MIN)
  expires_at: '0',
};
const fundYocto = NEAR / 200n;                                        // 0.005 spendable in the row
const rowDepositYocto = BigInt(MAIN.board?.max_row_yocto || 2n * 10n ** 22n);
const callsDepositYocto = BigInt(CALLS_DEPOSIT_YOCTO);
const GAS_OPEN = 100n * TG, GAS_CALLS = 100n * TG, GAS_CLOSE = 50n * TG, GAS_TRANSFER = 1n * TG;
// Hold build (CM6WA2gZ… and later): open+set_calls burnt 0.0024163 NEAR on mainnet
// (FeUwnaZK…, 1 receiver / 5 pairs, storage 0.02551 — the unit test reproduces that exactly).
// This row (8 receivers / 17 pairs) locks 0.03423 in contracts/charter_board
// a_row_with_every_board_shop_fits_the_row_cap, under the 0.04 cap.
const MEASURED_BURN_OPEN = 2_416_337_386_732_800_000_000n;
const MEASURED_ROW_STORAGE = FULL ? 34_230_000_000_000_000_000_000n : 29_580_000_000_000_000_000_000n;

export function checkRules(r, calls) {
  const bad = [];
  if (!(r.window_start_min < 1440 && r.window_end_min < 1440)) bad.push('ERR_WINDOW: both window ends must be < 1440 (use 0/0)');
  const min = BigInt(r.min_amount), cap = BigInt(r.per_action_cap);
  if (!(min > 0n && min <= cap)) bad.push('ERR_MIN: 0 < min_amount <= per_action_cap');
  if (!r.receivers?.length) bad.push('no receivers');
  for (const c of calls) {
    if (typeof c !== 'object' || Array.isArray(c) || !c.receiver || !c.method || !c.cap) bad.push('ERR_ARGS: calls must be {receiver, method, cap} objects');
    // `stamp` is a call on the board itself and returns its NEAR to the row; the board exempts it.
    else if (!(c.method === 'stamp' && c.receiver === MAIN.board?.contract) && !r.receivers.includes(c.receiver)) bad.push(`call receiver ${c.receiver} is not in rules.receivers`);
  }
  return bad;
}

const post = async (method, params) => {
  const res = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await res.json();
  if (j.error) throw Object.assign(new Error(j.error.cause?.name || j.error.name), { cause: j.error });
  return j.result;
};
const viewAccount = id => post('query', { request_type: 'view_account', finality: 'final', account_id: id }).catch(e => (e.message === 'UNKNOWN_ACCOUNT' ? null : Promise.reject(e)));
const getRow = async owner => {
  const out = await post('query', { request_type: 'call_function', finality: 'final', account_id: board, method_name: 'get_charter', args_base64: Buffer.from(JSON.stringify({ owner })).toString('base64') });
  const t = Buffer.from(out.result).toString('utf8');
  return t ? JSON.parse(t) : null;
};
const near = y => (Number(y) / 1e24).toFixed(6);

// Persist-then-fund. Never overwrites: an existing file means a previous run minted these keys.
function loadOrMintKeys() {
  if (existsSync(KEYFILE)) {
    if ((statSync(KEYFILE).mode & 0o077) !== 0) throw new Error(`${KEYFILE} must be chmod 600`);
    return { ...JSON.parse(readFileSync(KEYFILE, 'utf8')), reused: true };
  }
  const v = KeyPair.fromRandom('ed25519'), a = KeyPair.fromRandom('ed25519');
  const rec = { visitor_id: Buffer.from(v.getPublicKey().data).toString('hex'), visitor_secret: v.toString(), agent_public: a.getPublicKey().toString(), agent_secret: a.toString() };
  mkdirSync(dirname(KEYFILE), { recursive: true, mode: 0o700 });
  const fd = openSync(KEYFILE, 'wx', 0o600);
  writeSync(fd, JSON.stringify(rec)); fsyncSync(fd); closeSync(fd);
  const back = JSON.parse(readFileSync(KEYFILE, 'utf8'));
  if (back.visitor_secret !== rec.visitor_secret || back.agent_secret !== rec.agent_secret) throw new Error('key file read-back mismatch; not funding');
  return { ...rec, reused: false };
}

async function main() {
  if (!board || !root) throw new Error('mainnet.json needs board.contract and root');
  const bad = checkRules(RULES, CALLS);
  if (bad.length) { console.error(JSON.stringify({ refused: bad })); process.exit(2); }

  const gasPrice = BigInt((await post('gas_price', [null])).gas_price);
  const prepaid = g => g * gasPrice;                       // reserved up front, unused part refunded
  const visitorId = fresh ? null : process.env.NEAR_IMPLICIT_ACCOUNT;
  if (!fresh && !visitorId) throw new Error('set NEAR_IMPLICIT_ACCOUNT (or pass --new)');

  const acct = visitorId ? await viewAccount(visitorId) : null;
  const row = visitorId ? await getRow(visitorId) : null;
  const ownerAcct = await viewAccount(root);
  const deposits = rowDepositYocto + callsDepositYocto;
  const reserveForSend = deposits + prepaid(GAS_OPEN + GAS_CALLS);
  const rowBack = row ? BigInt(row.balance) + BigInt(row.storage_locked) : 0n;
  const free = acct ? BigInt(acct.amount) - BigInt(acct.storage_usage) * BYTE : 0n;
  // Funding for a new account: what it must hold while the open tx is in flight, plus its own storage.
  const fundNew = fresh ? reserveForSend + ACCOUNT_BYTES * BYTE : 0n;
  const closeBurn = row ? prepaid(GAS_CLOSE) / 10n : 0n;   // upper bound; close is a small receipt
  const spentForGood = MEASURED_BURN_OPEN + closeBurn + (fresh ? prepaid(GAS_TRANSFER) : 0n);

  const plan = {
    dry_run: !apply, mode: fresh ? 'new_account' : 'reuse_held_key', board, gas_price_yocto: String(gasPrice),
    visitor: visitorId || '(minted at --apply, persisted to KEYFILE before funding)',
    visitor_free_near: acct ? near(free) : null,
    existing_row: row ? { balance_near: near(row.balance), storage_near: near(row.storage_locked), refund_on_close_near: near(rowBack), expires_at: row.rules?.expires_at ?? row.expires_at } : null,
    rules: RULES, calls: CALLS,
    steps: [
      ...(fresh ? [`fund: ${root} -> visitor ${near(fundNew)} NEAR (exact: deposits ${near(deposits)} + prepaid gas ${near(prepaid(GAS_OPEN + GAS_CALLS))} + account storage ${near(ACCOUNT_BYTES * BYTE)})`] : []),
      ...(row ? [`close_charter on the old row: board refunds ${near(rowBack)} NEAR to the visitor`] : []),
      `open_charter + set_calls: attach ${near(rowDepositYocto)} + ${near(callsDepositYocto)}; board keeps fund ${near(fundYocto)} + storage ~${near(MEASURED_ROW_STORAGE)}, refunds the rest`,
    ],
    cost: {
      new_near_from_owner: near(fundNew),
      locked_in_row_refundable_on_close: near(fundYocto + MEASURED_ROW_STORAGE),
      gas_burnt_non_refundable_estimate: near(spentForGood),
      visitor_needs_free_at_send: near(reserveForSend),
    },
    checks: {
      rules_ok: true,
      visitor_can_pay: fresh ? true : free + rowBack >= reserveForSend,
      owner_can_fund: !fresh || BigInt(ownerAcct.amount) - BigInt(ownerAcct.storage_usage) * BYTE > fundNew,
    },
    sends: false,
  };
  if (!apply) { console.log(JSON.stringify(plan, null, 1)); return; }
  if (Object.values(plan.checks).some(x => x !== true)) { console.error('Refusing: a pre-check failed', JSON.stringify(plan.checks)); process.exit(1); }

  const provider = new JsonRpcProvider({ url: rpc });
  let vId, vSecret, agentPublic;
  if (fresh) {
    const k = loadOrMintKeys();                                   // persisted + verified first
    vId = k.visitor_id; vSecret = k.visitor_secret; agentPublic = k.agent_public;
    const have = await viewAccount(vId);
    if (!have || BigInt(have.amount) < fundNew) {
      const ownerSecret = process.env.NEAR_MAIN_PRIVATE_KEY || '';
      if (!ownerSecret.startsWith('ed25519:')) throw new Error('set NEAR_MAIN_PRIVATE_KEY');
      const owner = new Account(root, provider, KeyPairSigner.fromSecretKey(ownerSecret));
      const need = fundNew - (have ? BigInt(have.amount) : 0n);
      const r = await owner.signAndSendTransaction({ receiverId: vId, waitUntil: 'FINAL', throwOnFailure: false, actions: [actions.transfer(need)] });
      console.log(JSON.stringify({ step: 'fund', hash: r.transaction.hash, near: near(need), ok: !r.status?.Failure }));
      if (r.status?.Failure) process.exit(1);
    }
  } else {
    vId = visitorId; vSecret = process.env.NEAR_IMPLICIT_PRIVATE_KEY || '';
    if (!vSecret.startsWith('ed25519:')) throw new Error('set NEAR_IMPLICIT_PRIVATE_KEY');
    const k = loadOrMintKeys(); agentPublic = k.agent_public;     // only the agent key is new
  }
  const visitor = new Account(vId, provider, KeyPairSigner.fromSecretKey(vSecret));
  if (await getRow(vId)) {
    const c = await visitor.signAndSendTransaction({ receiverId: board, waitUntil: 'FINAL', throwOnFailure: false, actions: [actions.functionCall('close_charter', {}, GAS_CLOSE, 0n)] });
    const cBad = c.receipts_outcome?.find(x => x.outcome.status.Failure);
    console.log(JSON.stringify({ step: 'close_old_row', hash: c.transaction.hash, ok: !cBad }));
    if (cBad) process.exit(1);
  }
  const { open } = openRowTransactions({
    accountId: vId, contract: board, rules: RULES, agentPublicKey: agentPublic,
    fundYocto: String(fundYocto), rowDepositYocto: String(rowDepositYocto), callsDepositYocto: String(callsDepositYocto),
    calls: CALLS, effects: [], gasOpen: String(GAS_OPEN), gasAgent: String(GAS_CALLS), allowance: String(25n * 10n ** 22n),
  });
  const o = await visitor.signAndSendTransaction({
    receiverId: open.receiverId, waitUntil: 'FINAL', throwOnFailure: false,
    actions: open.actions.map(a => actions.functionCall(a.params.methodName, a.params.args, BigInt(a.params.gas), BigInt(a.params.deposit))),
  });
  const oBad = o.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
  console.log(JSON.stringify({ step: 'open_row_with_calls', hash: o.transaction.hash, ok: !oBad, error: oBad ? JSON.stringify(oBad).slice(0, 200) : undefined }));
  if (oBad) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(String(e.message || e).slice(0, 300)); process.exit(1); });
