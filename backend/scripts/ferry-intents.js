// NEAR Intents on Ferry, for the owner to run. This script never signs and never sends a
// deposit or a transaction: it asks 1Click for quotes and payloads and prints what to do.
// The wallet steps are yours.
//
//   node backend/scripts/ferry-intents.js
//   node backend/scripts/ferry-intents.js --signed-quote
//   node backend/scripts/ferry-intents.js --order
//   node backend/scripts/ferry-intents.js --orders
//   node backend/scripts/ferry-intents.js --verify-quote --from USDC@base --to USDC@near --amount 1
//
// Partner calls (generate-intent, submit-intent, every /v0/orders call) need
// ONECLICK_PARTNER_KEY in the environment. It is never read from the repo and never printed.
import { DEP, secret } from '../src/config.js';
import { quote } from '../src/ferry.js';
import * as intents from '../src/ferry-intents.js';
import { orderDeposit } from '../../shared/ferry/intents.js';

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const has = n => argv.includes(n);

const ROOT = DEP.root || 'nearcarta.near';
const BOARD = DEP.board?.contract || 'board.nearcarta.near';
const VISITOR = flag('--visitor') || ROOT;
const EVM_REFUND = flag('--refund-to') || '0x552ad18e18a49ddad1e7d96b7ddf813b04a9cfb5';
const hasKey = !!secret.oneClick();

const plan = {
  what: 'NEAR Intents features Ferry offers beyond an on-chain deposit swap',
  signs_here: false,
  sends_deposit: false,
  partner_key_present: hasKey,
  routes: {
    deposit_swap: 'unchanged: quote, then a deposit tx from your wallet, then GET /v0/status',
    signed_intent: `POST /api/ferry/intents/quote with depositType INTENTS → GET the payload from /v0/generate-intent → your wallet signs it → POST /api/ferry/intents/submit. No deposit tx.${hasKey ? '' : ' Needs ONECLICK_PARTNER_KEY.'}`,
    limit_order: `POST /api/ferry/orders at your own price. Confidential by default (basic).${hasKey ? '' : ' Needs ONECLICK_PARTNER_KEY.'}`,
  },
  board: { contract: BOARD, visitor: VISITOR },
  row_limit: 'every amount is still the visitor row from /setup; nothing here sets its own limit',
  cost: {
    signed_intent: 'no NEAR gas for a deposit: the swap spends an Intents balance. 1Click protocol fee still applies; the dry quote shows it.',
    limit_order: 'no NEAR gas to create. You deposit the order amount from your own wallet; an unfilled remainder is refunded to the refund address, minus the refund fee the order quotes.',
  },
};

/** One live dry quote, with the signature check Ferry relies on. */
async function verifyQuote() {
  const from = flag('--from') || 'USDC@base';
  const to = flag('--to') || 'USDC@near';
  const amount = flag('--amount') || '1';
  const q = await quote({ from, to, amount, recipient: VISITOR, refundTo: EVM_REFUND, privacy: 'public' });
  console.log(JSON.stringify({
    section: 'quote', from, to, amount,
    ok: q.ok, signed_by_1click: q.checks?.signature, echo_ok: q.checks?.echo?.ok,
    usd_in: q.from?.usd, out: q.to?.amount, cost_bps: q.cost_bps_signed,
    note: 'signed_by_1click is the manager signature over the quote payload; the status route checks the same signature before a "delivered" line.',
  }, null, 1));
}

/** A signed-intent quote: depositType INTENTS, no deposit tx. */
async function signedQuote() {
  const from = flag('--from') || 'wNEAR@near';
  const to = flag('--to') || 'USDC@near';
  const amount = flag('--amount') || '0.05';
  const out = await intents.signedIntentQuote({
    from, to, amount, recipient: VISITOR, refundTo: VISITOR,
    depositType: 'INTENTS', confidentiality: 'public',
  });
  console.log(JSON.stringify({
    section: 'signed_intent_quote', from, to, amount,
    ok: out.ok, deposit_type: out.depositType, deposit_address: out.depositAddress,
    needs_signature: out.needsSignature, signed_by_1click: out.signed,
    usd_in: out.from?.usd, out: out.to?.amount,
    next: out.needsSignature
      ? `The visitor signs the payload from /v0/generate-intent. To try it: node backend/scripts/ferry-intents.js --generate --deposit ${out.depositAddress || 'ADDRESS'} --signer ${VISITOR}`
      : (out.error || null),
    note: 'Nothing is deposited on this route. The funds must already be in Intents.',
  }, null, 1));
}

/** The payload to sign, and the shape to submit once signed. */
async function generate() {
  const depositAddress = flag('--deposit');
  const signerId = flag('--signer') || VISITOR;
  if (!depositAddress) { console.error('Pass --deposit ADDRESS from --signed-quote.'); process.exit(1); }
  const out = await intents.generateIntent({ depositAddress, signerId, standard: 'nep413' });
  console.log(JSON.stringify({
    section: 'generate_intent', ok: out.ok, standard: out.standard,
    sign_this: out.signThis, intent: out.intent, correlation_id: out.correlationId,
    error: out.error || null,
    next: out.ok ? 'Sign sign_this with the visitor wallet (NEP-413). Then POST /api/ferry/intents/submit with intent + public_key + signature.' : null,
  }, null, 1));
}

/** Create a limit order at the visitor's own price. */
async function order() {
  const side = (flag('--side') || 'SELL').toUpperCase();
  const quantity = flag('--quantity') || '1000000000000000000000000';
  const price = flag('--price') || '5';
  const out = await intents.createOrder({
    base: flag('--base') || 'wNEAR@near', quote: flag('--quote') || 'USDC@eth',
    quantity, side, price,
    refundTo: flag('--order-refund') || VISITOR, refundType: 'ORIGIN_CHAIN',
    recipient: flag('--order-recipient') || VISITOR, recipientType: 'ORIGIN_CHAIN',
    confidentiality: 'basic',
  });
  console.log(JSON.stringify({
    section: 'limit_order', side, quantity, price,
    ok: out.ok, error: out.error || null, order: out.order || null, deposit: out.deposit || null,
    next: out.ok ? `Send ${out.deposit?.amount} to ${out.deposit?.address} from your own wallet. Then: node backend/scripts/ferry-intents.js --orders` : null,
    refund: 'Cancel stops matching. Filled output is still withdrawn and the unfilled remainder is refunded to the refund address. A last slice can still fill.',
  }, null, 1));
}

async function orders() {
  const out = await intents.listOrders({ openOnly: true });
  console.log(JSON.stringify({ section: 'orders', ok: out.ok, error: out.error || null, open: out.open || [], count: (out.open || []).length }, null, 1));
}

async function cancel() {
  const id = flag('--cancel');
  if (!id) { console.error('Pass --cancel ORDER_ID.'); process.exit(1); }
  const out = await intents.cancelOrder(id);
  console.log(JSON.stringify({ section: 'cancel', ok: out.ok, error: out.error || null, note: out.note || null, order: out.order || null }, null, 1));
}

if (!hasKey) {
  // Still useful without the key: the default plan and a public dry quote.
  if (has('--verify-quote')) { await verifyQuote(); process.exit(0); }
  console.log(JSON.stringify({ ...plan, missing_key_note: 'ONECLICK_PARTNER_KEY is not set, so signed intents and orders will refuse with 503. The dry quote below still runs.' }, null, 1));
  await verifyQuote();
  process.exit(0);
}

if (has('--signed-quote')) await signedQuote();
else if (has('--generate')) await generate();
else if (has('--order')) await order();
else if (has('--orders')) await orders();
else if (has('--cancel')) await cancel();
else if (has('--verify-quote')) await verifyQuote();
else console.log(JSON.stringify(plan, null, 1));
