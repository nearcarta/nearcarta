# Nearcarta

[![ci](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml)

**An AI agent can be talked into paying the wrong person. Nearcarta puts the payment rules in a NEAR contract the agent cannot change, so a fooled agent produces a refused transaction instead of a loss.**

A visitor writes their agent's rules into one row on `board.nearcarta.near`: who it may pay, how much per payment, how much per day, and when it must ask a human. The agent holds a function-call key that can call exactly two methods — `propose` and `propose_call_as`. Every payment is checked on chain. It is allowed, refused with a reason, or held until the owner confirms. The refusal is a transaction you can open.

The town is how you see it: a 3D island at dusk, nine real mainnet shops, and a robot lamplighter that walks the lane.

- Live: **https://nearcarta.vercel.app**
- API: **https://nearcarta-api.onrender.com**
- Start here: **https://nearcarta.vercel.app/setup**

---

## What it is, in one page

| Piece | What it does | Where |
|---|---|---|
| **The charter** | One row per visitor. Allowlist, per-payment cap, daily budget, daily count, time window, expiry, frozen flag, ed25519 agent key. The agent's key can only ask. | `contracts/charter_board` → `board.nearcarta.near` |
| **The agent** | A NEAR AI model in a TEE reads a sentence and proposes one payment. It never signs. The charter decides. | `backend/src/agent.js` `propose` |
| **The town** | Nine shops, one panel system, one charter behind all of them. | `app/design/D9_world`, `app/src/panels` |
| **The receipts** | One shape for a NEAR payment, a chain-signature toll, an Intents quote and a model job. | `shared/rails/receipts.js` |

**The problem it solves.** An agent with a wallet key can be talked into paying anyone: a fake invoice, a prompt-injected recipient, a look-alike account, many payments just under a cap. Checks that live in the agent's own prompt or code fail the moment the agent is fooled. A rule in a contract the agent has no authority over does not.

---

## The nine shops, and the eight tracks

Each shop is a real mainnet dApp and a room in the town. Open any of them with `/?shop=<id>`.

| Track | Shop | What it does | Contract | File | Test | On chain |
|---|---|---|---|---|---|---|
| DeFi | Ferry | Swaps NEAR or USDC through NEAR Intents. Compares two quotes, marks the larger output, shows USD, ETA and fee, then asks 1Click for a deposit address only when the visitor's row allows the recipient and the amount. | `intents.near` | `backend/src/ferry.js`, `backend/src/ferry-checkout.js` `openCheckout` | `a refused recipient never asks 1Click, and an allowed one returns a deposit address` | swap [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw) |
| Privacy | Mist Bank | Audits a statement in the browser, and the model runs inside a NEAR AI TEE with a fresh nonce bound to that question. The audit can then tighten the visitor's own row cap. | `board.nearcarta.near` | `app/src/panels/bank-audit.js`, `backend/src/tee.js` | `an ecdsa receipt is recovered in the browser` | tighten [9wxG5aEr…](https://nearblocks.io/txns/9wxG5aErrrU72tH4oTt8dAdku3KXqWybJr7yXL32bFRY) |
| AI Security | Guardhouse | Checks a payee (age, code hash, look-alike, deny list), then pays through a hold. A warning stays held until a person presses Confirm; the agent cannot release it. The dock is model-backed: a typed sentence becomes a proposal. | `board.nearcarta.near`, `guard.nearcarta.near` | `app/src/panels/guard-agent.js` `runGuardAgentWithModel`, `contracts/guard` | `the guard dock asks the model, and falls back to the parser when the model cannot answer` | hold [9qxsoyA8…](https://nearblocks.io/txns/9qxsoyA8VrecsCh13yuUFhCk7QxEM4ueMVbicJvxyXwT), refusal [8df5Zu8U…](https://nearblocks.io/txns/8df5Zu8UGFsFvETbr99pMZBmEpP3ZFEeCnWePPKVZBqZ) |
| Agent Economy | Town Hall | Posts a job with a budget split across parts, takes bids, counters once, and holds a pass until the delivered digest clears. | `townhall.nearcarta.near` | `contracts/hall`, `shared/hall/job.js` | `a job conserves escrow, counters once, and does not pay on a swapped or blocked review` | reward [6UxwRmoE…](https://nearblocks.io/txns/6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h), refusal [Cp2rWatn…](https://nearblocks.io/txns/Cp2rWatnDBHRhbmGdrNqFbr14tg42TW4cAMTjp4Bsnu6) |
| Real-World Money | Payouts | Pays reviewed in-cap NEAR rows with one `propose` each and refuses an over-cap row before any deposit. An invoice is a durable `/pay/<id>` link whose receive account and amount a payer query cannot change. Line items decide the total. | `board.nearcarta.near` | `app/src/panels/payouts-plan.js` `canonicalInvoice`, `backend/src/payouts-invoice.js` | `an invoice with line items sums them and ignores a conflicting total` | allowed [4jEjzpiY…](https://nearblocks.io/txns/4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia), refused [AsZUd9mZ…](https://nearblocks.io/txns/AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx) |
| Autonomous Business | Toll Bridge | A pay-per-use gate whose fee, chain and recipient come from the live policy. Asks the NEAR MPC signer for a Base signature. | `toll.nearcarta.near` | `contracts/toll` `sign`, `shared/rails/receipts.js` | `a_failed_crossing_promises_refund_action_for_that_row` | allow [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz), refusal [B9FFjcSA…](https://nearblocks.io/txns/B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR) |
| Autonomous Business | Chronicle | Reads one account across board, Ferry, Toll, foreign and Guard rails, writes a local statement, and exports a CSV an accountant can open. Names coverage gaps instead of pretending to a complete index. | `board.nearcarta.near` | `app/src/panels/chronicle-view.js`, `backend/src/chronicle-*.js` | `yocto and token units are not shown as whole NEAR` | [8WDqBeaN…](https://nearblocks.io/txns/8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR) |
| Games | Vault Arena | A guardian NFT with an oath. Mint, feed the pot, attack, withdraw. An attempt that breaks the oath is refused on chain and badged once. | `arena.nearcarta.near` | `contracts/arena`, `app/src/panels/arena/tray.js` | `refusals_are_recorded_and_badged_once`, `one_action_per_attempt`, `only_agent_can_act` | [AZWxqZns…](https://nearblocks.io/txns/AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht), [25LpJRFF…](https://nearblocks.io/txns/25LpJRFF6ugmRdF8eH7Rw7dpkMthQjG6XWXFyx9mqa6V) |
| Open | Your House | A NEP-171 deed that carries a purse, a check-in clock and an inheritance line. Selling the deed moves the purse and the old holder loses control. | `house.nearcarta.near` | `contracts/house_nft`, `app/src/panels/house-room.js` | `holder_pays_under_cap_and_purse_moves_with_the_deed`, `deed_sold_mid_payout_settles_once_and_the_new_holder_keeps_the_purse` | allowed [83nyJmTW…](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26), refused [3Z4UAb6N…](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1) |

---

## The spend gate, and why it is a contract

Three properties, and each one is pinned by a test and a transaction.

**1. The agent's key can only ask.** The row holds a function-call key scoped to `propose` and `propose_call_as`. It cannot call an owner method and it cannot transfer NEAR. When the full-access key was removed, that was a transaction: [71Zio28gV3…](https://nearblocks.io/txns/71Zio28gV3yubD5DecGtkguWzWdfix8brcKFy13d3zzt). Test: `adv_agent_key_cannot_call_owner_methods_or_transfer` (`contracts/oath`).

**2. A payment outside the rules is refused on chain, with a reason.** `propose_call_as` checks expiry, the ed25519 signature over the exact call, the frozen flag, clause expiry, the time window, the minimum amount, the receiver allowlist, the per-shop cap, the session cap, the per-action cap, the daily budget, the daily count, the balance and the hold count — in that order — before any NEAR moves.

| Refusal | Transaction | Reason string |
|---|---|---|
| Over the per-action cap | [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH) | `over_per_action_cap` |
| Payee not on the list | [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) | `receiver_not_allowlisted` |
| Over the per-shop cap | [8df5Zu8U…](https://nearblocks.io/txns/8df5Zu8UGFsFvETbr99pMZBmEpP3ZFEeCnWePPKVZBqZ) | `over_shop_cap` |
| Over the board cap | [CcPMX1Dt…](https://nearblocks.io/txns/CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF) | held, then refused |

**3. A warning is held, not paid.** `propose_call_as` with `hold: true` stores a pending hold instead of forwarding. [9qxsoyA8…](https://nearblocks.io/txns/9qxsoyA8VrecsCh13yuUFhCk7QxEM4ueMVbicJvxyXwT) is a second 0.001 NEAR payment that became a hold. The agent cannot confirm its own hold; only the owner's key can, and `cancel_hold` refunds the row.

**The model cannot move the money either.** `backend/src/agent.js` `propose` asks the model for a reading, then refuses any answer that names a payee the visitor did not write or an amount above the one they typed. Tests: `a model that invents a payee is discarded for the words`, `a model that raises the amount is kept to the amount in the message`.

**Any visitor gets their own row on the same contract.** There is no per-user contract and no owner-operated queue: one deployed board holds every visitor's row, keyed by their account. `contracts/charter_board_sandbox/tests/two_visitors.rs` deploys one board into a local near-sandbox, opens two unrelated rows, and checks each can only act inside its own rules and that teardown pays the owner — test `two_visitors_share_one_board_and_teardown_pays_the_owner`, run by `board-sandbox` on every push. Opening a row is one wallet approval on `/setup`; the gas is measured against the committed wasm in `setup_open_gas.rs` (`open_charter` with six receivers burns 4.01 Tgas, `set_calls` 5.09, together 8.53).

---

## What you can do in sixty seconds, and what you should see

Nine checks. If any output differs from the right-hand column, the claim in this file is wrong and that is the finding.

| # | Do this | You should see |
|---|---|---|
| 1 | `npm ci && npm test` | `# pass 898`, `# fail 0`, `# skipped 1` |
| 2 | `npm run verify:mainnet` | `106/106` rows re-read from mainnet, written to `judges/proofs/mainnet-proof-check.json` |
| 3 | `npm run check-cited` | `MISSES: none` — every file, account, code hash and sha256 in the docs exists |
| 4 | `cd contracts/oath && cargo +1.95.0 test --lib` | `122 passed` (the `+1.95.0` matters: the crate needs edition2024) |
| 5 | Open https://nearcarta.vercel.app and press **Start here** | `/setup`, step 1 of 7, a mainnet account field — no faucet, no testnet |
| 6 | In the town open **All shops** → **Mist Bank**, press **Audit privately** | A sample statement read in the browser: `3 lines · 3 counted · NEAR`, and one anomaly naming `cafe.near, 0.01 NEAR. It appears twice in November` |
| 7 | Switch the sample to **Coffee month**, audit, press **Apply tighter limits** | `Cap on your row is now 0.008 NEAR (was 0.02)`. Then `curl -s https://nearcarta.vercel.app/api/board/row/<your-account>` shows `"per_action_cap":"8000000000000000000000"` — page and chain agree |
| 8 | Open **Vault Arena** → **Feed**, type a guardian id and 0.001 | A transaction hash with a nearblocks link, and the tray says *The coin landed.* |
| 9 | In the Guardhouse, type `send 0.001 NEAR to cafe.near` into the dock | The dock calls the model, then the same guard check: the reply says the payment is held until you press Confirm |

Steps 7 and 8 need a row, which `/setup` opens in one wallet approval. The rest are reads.

---

## Where things live

```
contracts/
  charter_board/   the visitor row: allowlist, caps, holds, calls   -> board.nearcarta.near
  oath/            the per-charter oath, the original spend gate     -> tests only now
  toll/            pay-per-use gate, asks the MPC signer             -> toll.nearcarta.near
  hall/            job escrow, bids, counter, review digest           -> townhall.nearcarta.near
  arena/           guardian NFTs, oath-scored attempts                -> arena.nearcarta.near
  house_nft/       NEP-171 deed, purse, check-in, inheritance         -> house.nearcarta.near
  guard/           keyless forwarder, refunds on a failed route       -> guard.nearcarta.near
backend/src/       the API: one module per shop, no mainnet signing
app/src/panels/    the console and the nine shop trays
app/design/        the 3D town (D9_world) and the shop interiors (D8_shops)
shared/            the contract-facing logic both sides share
shared/deployments/mainnet.json   every account, contract and proof tx
```

**Addresses live in one file.** `shared/deployments/mainnet.json` is the only place an account, code hash or proof transaction is written down. Code and docs read from it; nothing is hardcoded. `npm run check-cited` fails if a doc names something that file does not.

The house shop is one account, `house.nearcarta.near`, and it is the same account the legacy shop used: `extras.house` in that file is the record and its `shop` field holds that id. The record path is not an account id — reading it as one is what put a nonexistent address in these docs, and RPC answers `UNKNOWN_ACCOUNT` for it.

---

## Design

The city is a low-poly island at dusk with a lighthouse, a ward, a ferry jetty and nine buildings you walk into. Each shop is a room, not a page.

Every shop uses one panel: **480px wide, 18px radius, one header with the shop's own 3D icon, one segmented tab bar, one field rhythm, one gold action**. Each room keeps its own accent colour so the nine stay recognisable, and the palette stays the project's dark brown and gold.

The panels are built to hold their whole form without a scrollbar at 1440×900, and the layout was measured rather than eyeballed: the numbers in the commits come from `scrollHeight` against `clientHeight` in the real page. On a 390px phone the panel is full width and five of the nine fit without scrolling; the other four scroll inside a single region rather than hiding a field or shrinking a control below a comfortable target.

The 3D scenes are unchanged by the panel work. The chrome sits over the room; the room is the shop.

---

## Technologies

| Primitive | How it is used here | Evidence |
|---|---|---|
| **Function-call access keys** | The agent holds a key scoped to `propose` and `propose_call_as`; the account has no full-access key | `view_access_key_list` on `board.nearcarta.near` returns `[]`; [71Zio28gV3…](https://nearblocks.io/txns/71Zio28gV3yubD5DecGtkguWzWdfix8brcKFy13d3zzt) |
| **On-chain spend policy** | The row checks payee, caps, budget, count, window, expiry, nonce and signature before paying | the four refusal transactions above |
| **Chain signatures (MPC)** | `toll.nearcarta.near` calls `v1.signer` with an ECDSA payload and recovers the address to verify it | [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz) |
| **NEAR Intents (1Click)** | Real quotes with the signature verified and the echo guarded; one settled swap | [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw) |
| **NEAR AI Cloud TEE** | A fresh 32-byte nonce per question; the report and the NVIDIA token must both echo it; the signed response is checked against the verified model report | `judges/proofs/tee-check.json`, `GET /api/ai/tee` |
| **NEP-171** | The house deed carries a purse, a check-in clock and an inheritance line, and moves all three on transfer | [FqYcLtmL…](https://nearblocks.io/txns/FqYcLtmLb7WM9vo83iMNyfSMiMnifSMLQJPJHwBzLtnu) |
| **NEP-245** | Multi-token guardians in `contracts/arena` | `mt_mint`, `mt_transfer`, `mt_balance_of` |

---

## Run it

```bash
npm ci
npm test                 # 899 unit tests (898 pass, 1 skipped)
npm run verify:mainnet                            # re-read every proof tx from mainnet
npm run check-cited                               # every cited file, account and hash exists
npm run build && npm run e2e   # 127 browser tests against the local API and app
cd contracts/oath && cargo +1.95.0 test --lib     # 122 pass
cd contracts/arena && cargo +1.95.0 test --lib    # 17 pass
```

# 899 unit tests (898 pass, 1 skipped):
- `npm test` — the backend suite, offline
- `npm run verify:mainnet` — every proof row re-read from mainnet (106/106 expected)
- `judges/proofs/e2e-vercel.json`: 20 passed, 1 skipped — the same browser suite against the deployed site
- contracts/oath — the agent charter (Rust, near-sdk). 122 unit tests
- contracts/arena — 17 unit tests
- contracts/charter_board — 36 unit tests

# 899 backend unit tests (898 pass, 1 skipped)

The API holds no NEAR key on the deployed host and never signs a mainnet transaction. Everything that moves money is signed by the visitor's own wallet or by their own session key inside their row.

---

## The agent

The Lamplighter is the character. The agent is what it stands for: a model that proposes and a contract that decides.

```
visitor types a sentence
        |
        v
NEAR AI model in a TEE          backend/src/agent.js  propose
  - reads the words
  - proposes ONE payment
  - refuses to name a payee the visitor did not
  - refuses to raise the amount the visitor typed
        |
        v
the visitor's row               board.nearcarta.near  propose_call_as
  - allowlist, caps, budget, count, window, expiry, nonce, signature, frozen
        |
        +--> allowed   -> the payment is forwarded
        +--> refused   -> a transaction with a reason you can open
        +--> warned    -> a hold, released only by the owner's key
```

Each shop dock speaks the same shape. The Guardhouse dock is model-backed end to end. The other six are labelled **Commands**, because that is what they are: they parse the phrasing their placeholder shows, with no model call. Calling a command palette an agent was an over-claim, and the label now matches the code.
