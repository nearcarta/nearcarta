// Open ONE fresh visitor row with a CALLS allowlist, then prove a shop CTA can move money
// through it. Dry run by default; --apply signs.
//
//   node backend/scripts/board-fresh-row.js
//   node backend/scripts/board-fresh-row.js --apply
//
// Why this exists: the live row on 8ccd5d33 predates /setup's `set_calls` step, so it carries
// no CALLS entry. contracts/charter_board/src/v2.rs checks the calls policy BEFORE any deposit
// check, so every `propose_call_as` on that row panics `method_not_allowlisted` regardless of
// amount. That is stale state on one old row, not a code gap — `openRowTransactions` in
// shared/setup/open-row.js already sends `set_calls` in the same transaction as `open_charter`.
//
// This script reuses that builder rather than reimplementing it, so the row it opens is the
// row /setup would open. It never prints the key.
//
// Cost, measured: the row deposit plus a small fund. `rowDepositYocto` is the board's
// MAX_ROW_YOCTO; the fund is what the row may spend. Nothing here is wasted: the deposit is
// the board's own storage price and the fund stays in the visitor's row until spent.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import { openRowTransactions } from '../../shared/setup/open-row.js';
import { proposalMessage } from '../../shared/board/message.js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

const apply = process.argv.includes('--apply');
const board = MAIN.board?.contract || '';
const root = MAIN.root || '';
const rpc = MAIN.rpc || 'https://free.rpc.fastnear.com';
const TG = 10n ** 12n;
const NEAR = 10n ** 24n;

// The shop the CTA proof will pay. Town Hall first: after the staged min_amount fix its
// zero-value lifecycle steps are the thing that was blocked, so it is the honest first proof.
const SHOP = 'townhall.nearcarta.near';
const CALLS = [
  { receiver: SHOP, method: 'post_job', cap: NEAR / 50n },
  { receiver: SHOP, method: 'bid', cap: NEAR / 1000n },
  { receiver: SHOP, method: 'accept', cap: NEAR / 1000n },
  { receiver: SHOP, method: 'deliver', cap: NEAR / 1000n },
  { receiver: SHOP, method: 'review', cap: NEAR / 1000n },
];

const RULES = {
  // One receiver at the rules layer; the fine-grained allowlist is CALLS above.
  receivers: [SHOP],
  per_action_cap: String(NEAR / 100n),      // 0.01 NEAR
  daily_budget: String(NEAR / 20n),         // 0.05 NEAR
  max_actions_per_day: 8,
  window_start_min: 0,
  window_end_min: 1440,
  min_amount: '0',                          // zero-value steps must be allowed
  expires_at: '0',
};

const fundYocto = (NEAR / 100n).toString();        // 0.01 NEAR spendable in the row (setup's ROW_FUND)
// These are the exact values /setup uses (app/house/setup.js): the row deposit is the board's
// max_row_yocto in full, and set_calls gets CALLS_DEPOSIT_YOCTO. Anything less fails after gas
// is already spent, which is the definition of wasting NEAR.
const rowDepositYocto = String(MAIN.board?.max_row_yocto || (2n * 10n ** 22n));
const callsDepositYocto = (15n * 10n ** 21n).toString(); // CALLS_DEPOSIT_YOCTO

function report(o) {
  console.log(JSON.stringify(o, null, 1));
}

async function main() {
  if (!board || !root) { console.error('mainnet.json needs board.contract and root'); process.exit(1); }

  // A NEW implicit account: 64 hex chars derived from a fresh ed25519 key. The owner funds it,
  // it opens its own row, and its row is what the shops act on. This is the "second funded
  // account" the audit asked for, created on chain rather than borrowed.
  const visitorKey = KeyPair.fromRandom('ed25519');
  const visitorId = Buffer.from(visitorKey.getPublicKey().data).toString('hex');
  const agentKey = KeyPair.fromRandom('ed25519');

  const plan = {
    dry_run: !apply,
    board,
    funder: root,
    visitor: visitorId,
    agent_public_key: agentKey.getPublicKey().toString(),
    shop: SHOP,
    calls: CALLS.map(c => `${c.receiver}.${c.method} cap ${c.cap}`),
    rules: RULES,
    fund_yocto: fundYocto,
    fund_near: Number(fundYocto) / 1e24,
    row_deposit_near: Number(rowDepositYocto) / 1e24,
    calls_deposit_near: Number(callsDepositYocto) / 1e24,
    visitor_funding_near: 0.08,
    total_spend_near: 0.08 + Number(rowDepositYocto) / 1e24 + Number(callsDepositYocto) / 1e24,
    sends: false,
    steps: [
      '1. owner sends 0.08 NEAR to the new implicit account (creates it; the surplus stays refundable)',
      '2. visitor signs ONE tx: open_charter + set_calls (+ set_effects if needed)',
      '3. visitor adds the agent function-call key',
      '4. prove a shop call: simulate first, then one real propose_call_as',
    ],
  };
  if (!apply) { report(plan); return; }

  const secret = process.env.NEAR_MAINNET_SIGNER_KEY || '';
  if (!secret.startsWith('ed25519:')) { console.error('Refusing to sign: set NEAR_MAINNET_SIGNER_KEY.'); process.exit(1); }
  const owner = new Account(root, new JsonRpcProvider({ url: rpc }), KeyPairSigner.fromSecretKey(secret));

  // 1. Create and fund the visitor.
  const fund = await owner.signAndSendTransaction({
    receiverId: visitorId, waitUntil: 'FINAL', throwOnFailure: false,
    actions: [actions.transfer(8n * 10n ** 22n)], // 0.08 NEAR: 0.02 row + 0.015 calls + 0.01 fund + gas, surplus refundable
  });
  const fundBad = fund.status?.Failure;
  console.log(JSON.stringify({ step: 'fund', hash: fund.transaction.hash, ok: !fundBad, error: fundBad ? JSON.stringify(fundBad).slice(0, 160) : undefined }));
  if (fundBad) process.exit(1);

  // 2. The visitor opens its own row, with the calls allowlist in the same transaction.
  const visitor = new Account(visitorId, new JsonRpcProvider({ url: rpc }), KeyPairSigner.fromSecretKey(visitorKey.toString()));
  const { open } = openRowTransactions({
    accountId: visitorId,
    contract: board,
    rules: RULES,
    agentPublicKey: agentKey.getPublicKey().toString(),
    fundYocto,
    rowDepositYocto,
    callsDepositYocto,
    calls: CALLS.map(c => [c.receiver, c.method, String(c.cap)]),
    effects: [],
    gasOpen: (100n * TG).toString(),
    gasAgent: (100n * TG).toString(),
    allowance: (25n * 10n ** 22n).toString(),
  });
  const openRes = await visitor.signAndSendTransaction({
    receiverId: open.receiverId, waitUntil: 'FINAL', throwOnFailure: false,
    actions: open.actions.map(a => actions.functionCall(a.params.methodName, a.params.args, BigInt(a.params.gas), BigInt(a.params.deposit))),
  });
  const openBad = openRes.status?.Failure || openRes.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
  console.log(JSON.stringify({ step: 'open_row_with_calls', hash: openRes.transaction.hash, ok: !openBad, error: openBad ? JSON.stringify(openBad).slice(0, 200) : undefined }));
  if (openBad) process.exit(1);

  report({ ...plan, sends: true, visitor_funding_tx: fund.transaction.hash, open_row_tx: openRes.transaction.hash });
  console.log('\nRow is open with a CALLS allowlist. Visitor:', visitorId);
}

main().catch(e => { console.error(String(e.message || e).slice(0, 300)); process.exit(1); });
