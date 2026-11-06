# Ferry and NEAR Intents

Ferry talks to NEAR Intents through 1Click's `/v0` API. The on-chain deposit swap was
already live; this page covers the three features added on top of it, and what is proven
versus what needs the owner's wallet.

Docs for the upstream API are in `docs/internal/intents/`. Everything below names the
file that implements it and the test that pins it.

## Routes Ferry offers

| Route | What the visitor does | Code |
|---|---|---|
| Deposit swap | Quote, send the deposit from their own wallet, watch `/v0/status`. Unchanged. | `backend/src/ferry-checkout.js` `openCheckout` |
| **Signed intent** | Quote with `depositType: INTENTS`. The wallet signs the payload `/v0/generate-intent` returns. `/v0/submit-intent` submits it. **No deposit transaction.** | `backend/src/ferry-intents.js` `signedIntentQuote`, `generateIntent`, `submitIntent` |
| **Limit order** | Name a price. 1Click rests the order until it fills, is cancelled, or its deadline passes. | `backend/src/ferry-intents.js` `createOrder`, `listOrders`, `getOrder`, `cancelOrder` |

The visitor's `/setup` row is still the only limit. A signed intent spends an Intents
balance, so the row caps what it can move; an order deposit is funded by the visitor's own
wallet, and `orderFitsRow` refuses one above the row cap or the row balance.

The tray shows both routes: a radio under the swap card picks **Deposit on the origin
chain** or **Signed intent · no deposit tx**, and the **Routes** tab lists open orders with
Cancel.

## Signature checks

1Click signs a quote payload (ed25519 over base58(sha256(stable JSON))). Ferry verifies it
before showing a deposit address or a price.

- **Quote**: `backend/src/ferry.js` `checkQuote` → `verifyQuoteSignature`, against
  `QUOTE_SIGNER` (`ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`).
- **Status**: 1Click does **not** sign the status document. What it carries is the signed
  `quoteResponse` the deposit belongs to, so `statusSignature` re-verifies that quote, and
  `deliveryVerdict` only lets `SUCCESS` mean delivered when that check passed. An unsigned
  or tampered status shows as unverified, never as delivered.
- Both live in `shared/ferry/intents.js`, which has no imports, so the browser and the
  backend use one rule.

Tests: `a status is trusted only through the signed quote it carries`, `only a verified
SUCCESS says delivered`, `the attached gas…` (see `backend/test/unit/ferry-intents.test.js`).

## Limit orders

`orderDeposit` follows the docs' formula: the quote-side amount is
`quantity × price × 10^quoteDecimals / 10^baseDecimals`, rounded up, and a SELL deposits the
base while a BUY deposits the quote side. `orderInput` refuses `public`
confidentiality, because a limit order is a confidential swap and `confidentiality` is a
required field.

Cancel is asynchronous. The docs say matching stops, filled output is still withdrawn, and
the unfilled remainder is refunded to the refund address — and a last slice can still fill,
so an order may end `FILLED` instead of `CANCELED`. The tray and the API response both say
this.

Tests: `the order deposit follows the docs formula, rounded up`, `a limit order is always
confidential, and its body matches the API shape`, `an order view says what filled, what was
refunded, and that cancel is async`.

## Confidential swaps

`confidentiality` is offered on the quote and order paths, and refused with
`confidential_needs_partner_key` when `ONECLICK_PARTNER_KEY` is not set. A confidential
swap needs the partner key on the server; there is no anonymous path. The tray's Rules tab
stays the place that explains the session; the toggle lives on the swap card with the route
choice.

Test: `a confidential swap needs the partner key on the server`.

## What an agent can do from the chat

`parseOrderCommand` in `app/src/panels/ferry-pair.js` reads:

- `sell 1 NEAR at 5 USDC` → places a SELL limit order.
- `buy 1 NEAR on near at 5 USDC on base` → a BUY, both chains named.
- `cancel order ord_123` → cancels that order.
- `show my orders` → lists the open ones.

`runFerryAgent` routes those to `onOrder`, which calls the same endpoints the Routes tab
uses. A swap sentence still goes to Load cargo, never to the order path.

## Running it yourself

Nothing in this repo signs a mainnet transaction for these features. The script asks 1Click
for quotes, payloads and orders, and prints what to do next; your wallet does the rest.

```bash
# No key: the plan and one live dry quote with the signature check.
node backend/scripts/ferry-intents.js

# Signed intent (needs ONECLICK_PARTNER_KEY in the environment).
node backend/scripts/ferry-intents.js --signed-quote --from wNEAR@near --to USDC@near --amount 0.05
node backend/scripts/ferry-intents.js --generate --deposit DEPOSIT_ADDRESS --signer YOUR_ACCOUNT
#   sign `sign_this` with the wallet, then POST /api/ferry/intents/submit

# Limit order (needs ONECLICK_PARTNER_KEY).
node backend/scripts/ferry-intents.js --order --side SELL --quantity 1000000000000000000000000 --price 5
node backend/scripts/ferry-intents.js --orders
node backend/scripts/ferry-intents.js --cancel ORDER_ID
```

Costs, as far as this repo can say without running them:

- **Signed intent**: no NEAR gas for a deposit, because there is no deposit. The 1Click
  protocol fee still applies and the dry quote shows it (`cost_bps_signed`). The funds must
  already be in Intents; on `nearcarta.near` this is not funded today.
- **Limit order**: no NEAR gas to create. The visitor deposits the order amount from their
  own wallet. An unfilled remainder is refunded to the refund address, minus the refund fee
  the order quotes.

## What is not proven yet

- No signed intent has been submitted on mainnet from this repo. The flow is implemented and
  its body shape is pinned by tests; the signing step is the owner's.
- No limit order has been created on mainnet from this repo.
- The live routes need `ONECLICK_PARTNER_KEY`; without it they answer 503 with that exact
  message, not a blank error.
