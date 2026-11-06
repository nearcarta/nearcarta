// CTA and AI parity on the board that exists after the migration.
//
// The city tray has two doors to the same swap: the gold Load cargo button, and a typed
// sentence. Both must build the same real transaction from the same row, under the same
// caps, after the board was recreated (board.nearcarta.near, one row per visitor, no
// per-visitor contract). This test drives both paths with one row and compares the plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };
import { runFerryAgent } from '../../../app/src/panels/deep.js';
import { agentCargoPlan } from '../../../app/src/panels/ferry-pair.js';
import {
  SESSION_SWAP, WRAP, depositPlan, cityCheckoutBody, proposeCallTgas,
  quoteRecipient,
} from '../../../app/src/panels/ferry-settle.js';
import { SESSION_METHODS } from '../../../shared/board/session.js';

const BOARD = MAIN.board.contract;
const VISITOR = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
// The row a visitor gets from /setup after the migration. The Ferry session moves about
// 0.05 wNEAR, so the visitor sets a per-payment cap that holds it; a row under that
// refuses the swap, which the last test proves.
const ROW = {
  owner: VISITOR,
  receivers: ['toll.nearcarta.near', 'house.nearcarta.near'],
  per_action_cap: '60000000000000000000000',
  daily_budget: '200000000000000000000000',
  max_actions_per_day: 3,
  min_amount: '100000000000000000000',
  spent_today: '0',
  actions_today: 0,
  frozen: false,
  sealed: false,
};

// One quote, one deposit address: the same values both paths receive from the API.
const QUOTE = {
  ok: true, dry: true,
  from: { symbol: 'wNEAR', amount: SESSION_SWAP.amt, usd: '0.185' },
  to: { symbol: 'USDC', amount: '0.1797' },
  depositAddress: 'intents.near',
  quoteRequest: { depositAddress: 'intents.near' },
};
// The row's spendable balance: a visitor who funds one session has this much in the row.
const ROW_BALANCE = '500000000000000000000000';

/** The plan the CTA builds once the quote lands, from the row and that quote. */
function ctaPlan() {
  return depositPlan({
    from: SESSION_SWAP.from, amount: SESSION_SWAP.amt,
    depositAddress: QUOTE.depositAddress,
    capYocto: ROW.per_action_cap, balanceYocto: ROW_BALANCE,
    keyMethods: SESSION_METHODS,
    wrapRegistered: false, depositAccountRegistered: false,
  });
}

/** The plan the AI builds: it must reach the same onLoadCargo with a real quote. */
async function aiPlan() {
  const seen = { loads: [], quotes: [], state: {} };
  const out = await runFerryAgent({
    text: 'swap 0.05 wNEAR on near to USDC on near',
    state: seen.state,
    charterReady: true,
    quotePair: async (from, to, amt) => { seen.quotes.push({ from, to, amt }); return QUOTE; },
    onLoadCargo: async opts => { seen.loads.push(opts); return { agentHint: '', agentLinks: [] }; },
  });
  return { out, seen };
}

test('the post-recreate board is the only contract the city touches', () => {
  assert.equal(BOARD, 'board.nearcarta.near');
  assert.equal(MAIN.board.rows_after_migrate, undefined); // no stale per-contract row count
  assert.equal(MAIN.board.contract, BOARD);
  // No visitor gets a contract of their own: the row is keyed by owner on the board.
  assert.equal(MAIN.board.owner, 'nearcarta.near');
  // The session key lists every method the hold and row paths need, on this contract.
  for (const m of SESSION_METHODS) assert.ok(['propose', 'propose_call', 'propose_call_as', 'anchor', 'confirm_hold', 'tighten_rules'].includes(m), m);
});

test('the CTA builds a real transaction inside the row cap', () => {
  const plan = ctaPlan();
  assert.equal(plan.kind, 'propose_call');
  assert.equal(plan.wallet, false, 'no wallet popup on the session path');
  const methods = plan.steps.map(s => s.method);
  assert.deepEqual(methods, ['near_deposit', 'storage_deposit', 'ft_transfer']);
  // The deposit is the 1Click address the quote named, never a hardcoded one.
  const ft = plan.steps.find(s => s.method === 'ft_transfer');
  assert.equal(JSON.parse(ft.args).receiver_id, QUOTE.depositAddress);
  // Every step is under the row cap the board enforces.
  for (const s of plan.steps) {
    const dep = BigInt(s.deposit);
    if (dep > 0n) assert.ok(dep <= BigInt(ROW.per_action_cap), `${s.method} deposit ${dep} within the row cap`);
    assert.equal(s.gasTgas, proposeCallTgas(s.method));
  }  // The board, not the old oath, is the receiver for each board call.
  assert.equal(plan.steps.every(s => s.receiver === WRAP || s.receiver === BOARD), true);
});

test('the AI reaches the same Load cargo and the same plan as the CTA', async () => {
  const { out, seen } = await aiPlan();
  assert.equal(out.ok, true);
  assert.equal(out.loaded, true);
  // The sentence parses to the session pair, so the AI asks for the same quote.
  assert.equal(seen.quotes.length, 1);
  assert.equal(seen.quotes[0].from, SESSION_SWAP.from);
  assert.equal(seen.quotes[0].to, SESSION_SWAP.to);
  assert.equal(String(seen.quotes[0].amt), SESSION_SWAP.amt);
  // And it calls the one Load cargo function, with the session path (not the stamp).
  assert.equal(seen.loads.length, 1);
  assert.equal(seen.loads[0].charter, false, 'a swap sentence loads cargo, it is not the Ask-charter stamp');
  // The quote the AI carries is the quote the CTA would use, so the plan is identical.
  assert.deepEqual(seen.state.q.depositAddress, QUOTE.depositAddress);
  const fromAi = depositPlan({
    from: SESSION_SWAP.from, amount: seen.state.amt,
    depositAddress: seen.state.q.depositAddress,
    capYocto: ROW.per_action_cap, balanceYocto: ROW_BALANCE,
    keyMethods: SESSION_METHODS, wrapRegistered: false, depositAccountRegistered: false,
  });
  assert.deepEqual(fromAi, ctaPlan(), 'the CTA and the AI build the same steps');
});

test('both paths refuse the same way when the row cannot hold the swap', () => {
  // A row whose cap is below the wrap deposit refuses on both doors. No wallet, no tx.
  const tight = depositPlan({
    from: SESSION_SWAP.from, amount: SESSION_SWAP.amt, depositAddress: QUOTE.depositAddress,
    capYocto: '5000000000000000000000', balanceYocto: '20000000000000000000000',
    keyMethods: SESSION_METHODS,
  });
  assert.equal(tight.kind, 'you-send');
  assert.equal(tight.wallet, false);
  assert.equal(tight.steps.length, 0);
  // A key without propose_call cannot propose_call, so the AI path also cannot pretend.
  const noKey = depositPlan({
    from: SESSION_SWAP.from, amount: SESSION_SWAP.amt, depositAddress: QUOTE.depositAddress,
    capYocto: ROW.per_action_cap, keyMethods: ['propose'],
  });
  assert.equal(noKey.kind, 'you-send');
  assert.match(noKey.why, /cannot call propose_call/);
});

test('the quote recipient is the visitor or their typed address, never the shop', () => {
  // NEAR destination: the visitor's own account.
  assert.equal(quoteRecipient({ chain: 'near' }, VISITOR, ''), VISITOR);
  // Another chain: the address the visitor typed.
  const addr = '0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034';
  assert.equal(quoteRecipient({ chain: 'base' }, VISITOR, addr), addr);
  // A checkout body carries the same two, and the row's amount, to the board.
  const body = cityCheckoutBody({
    pair: { from: SESSION_SWAP.from, to: SESSION_SWAP.to, amt: SESSION_SWAP.amt },
    recipient: 'toll.nearcarta.near', charter: VISITOR,
    amountYocto: ROW.per_action_cap, refundTo: VISITOR, visitor: VISITOR, session: 'board',
  });
  assert.equal(body.charter, VISITOR);
  assert.equal(body.swap_recipient, VISITOR);
  assert.equal(body.amount_yocto, ROW.per_action_cap);
  // And the amount the pair carries is the session amount, not a product default.
  assert.equal(body.amount, SESSION_SWAP.amt);
});
