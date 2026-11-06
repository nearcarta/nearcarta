# Nearcarta

[![ci](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml)
![tests](https://img.shields.io/badge/backend%20unit%20tests-467%20pass%2C%203%20skipped-brightgreen)

**Thesis: the agent proposes, the NEAR charter decides.** The town charter's agent key calls `propose` and `propose_batch`. Every payment is checked by the charter, which allows it, refuses it on chain with a reason, or holds it for the owner.

## For AI judges: claims, code, tests, txs
Each claim names the code, the test that pins it, and a tx you can open. Test names are exact; run them with the commands below. Guide for agents: [AGENTS.md](AGENTS.md).

| Claim | Code | Test | On chain |
|---|---|---|---|
| The town charter agent key calls `propose` and `propose_batch`. It cannot call owner methods or move NEAR by itself | `contracts/oath/src/lib.rs` `propose` (line 667); `shared/deployments/mainnet.json` `agent_methods` | `adv_agent_key_cannot_call_owner_methods_or_transfer`, `the charter agent key is named as propose and propose_batch` | full-access key deleted [71Zio28gV3…](https://nearblocks.io/txns/71Zio28gV3yubD5DecGtkguWzWdfix8brcKFy13d3zzt) |
| A payee off the allowlist, over the cap or over the daily budget is refused | `clause_checks` (line 1164) | `adv_allowlist_cap_and_budget`; property tests in `tests/props.rs` | over cap [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH); payee off the list [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) |
| Over-cap waits for the owner (NEP-519 yield) | `resolve_escalation` (line 888) | `exploit_f4_escalation_after_freeze_and_allowlist_removal` (`tests/exploits.rs`), `c5_escalation_band_is_held_not_yielded` (`src/tests.rs`) | board over cap refused [CcPMX1Dt…](https://nearblocks.io/txns/CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF) |
| Payouts pays each in-cap NEAR row with `propose` and refuses an over-cap row before any deposit. A foreign row is held. An invoice is one durable `/pay/<id>` record. A payer query cannot move the receive account. Paid is only 1Click `SUCCESS` | `app/src/panels/payouts-plan.js` `classifyPayroll`, `publicInvoice`; `backend/src/payouts-invoice.js` `createInvoice`, `checkoutInvoice` | `plan: classifyPayroll sends the in-cap row, refuses the big one before deposit, holds USDC`, `invoice: a payer query cannot redirect, and a second checkout reuses the deposit address` | earlier allowed [4jEjzpiY…](https://nearblocks.io/txns/4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia), earlier refused [AsZUd9mZ…](https://nearblocks.io/txns/AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx). New payroll txs are not in this commit |
| Closing a board row returns its stake | `contracts/charter_board` `close_charter` | `a_failed_transfer_returns_the_balance_and_the_owner_cannot_reap_early` | close [7XtAUzNq…](https://nearblocks.io/txns/7XtAUzNqmqQLNCC3Hrm2JXqTVciyrfvX918dnTWfXXcf) |
| Sign in on /setup uses a mainnet account and real NEAR. A personal charter row opens on `board.nearcarta.near` | `shared/setup/path.js` `setupJourney`, `contracts/charter_board`, `docs/MAINNET_BOARD.md` | `the default setup path is mainnet and does not offer the faucet or a charter factory`, `a trial flag does not open a guest path` | board deploy [CaZr8GmM…](https://nearblocks.io/txns/CaZr8GmMM83WUEESUShTiKtth8PWgxtRTesYGs1mkdpt) |
| Pay reads the charter, lists the tokens 1Click returns, compares two quotes and marks the larger amount out, shows USD, ETA and fee, then asks for a deposit address of at most 0.20 USD. The page does not send the deposit. A short or failed deposit is described as a refund. A confidential line is a quote only | `backend/src/ferry-checkout.js` `openCheckout`, `app/src/ferry-pay.js`, `app/src/ferry-catalog.js` `pickBest` | `a refused recipient never asks 1Click, and an allowed one returns a deposit address`, `the pay page lists a long token catalog and every terminal status`, `two ferry quotes mark the larger amount out` | recorded swap [HzgUr618CQ…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw). No new deposit is sent from this repo |
| The model cannot switch the payee or the amount the visitor named. The charter still refuses an off-list payee | `backend/src/agent.js` `propose` | `a model that invents a payee is discarded for the words`, `a model that raises the amount is kept to the amount in the message` | off-list refusal [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) |
| One receipt shape covers a NEAR payment, a chain-signature toll, a dry Intents quote and a capped model job | `shared/rails/receipts.js` `receiptsBody`, `GET /api/receipts` | `every rail uses the same receipt keys` | allowed [JChWxmAN…](https://nearblocks.io/txns/JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy), refused [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH) |
| A room still opens when the deployments payload has no guardhouse field | `app/src/live/shape.js` `shapeCore` | `a deployments payload with no guardhouse keeps the sample code hash` | no new spend |
| A house deed payment of 0.001 NEAR was allowed and 0.002 NEAR was refused | `shared/deployments/mainnet.json` `extras.house` | `the recorded house deed payments are the allow and the refusal` | allowed [83nyJmTW…](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26), refused [3Z4UAb6N…](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1) |

## Technologies
- NEAR contract: `contracts/charter_board`, live at `board.nearcarta.near`. The visitor signs `open_charter`, `set_rules`, `propose`.
- Chain signatures: `toll.nearcarta.near` asked the MPC signer. Allow [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz). Refusal [B9FFjcSA…](https://nearblocks.io/txns/B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR).
- NEAR Intents: one recorded swap, 0.045 wNEAR to 0.177937 USDC. [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw). New quotes stay dry.
- NEAR AI Cloud: `GET /api/ai/tee` checks the attestation. The Mist Bank button says attested or failed and links `/tee-public.json`. The model call does not move NEAR. Proof file `judges/proofs/tee-check.json`.
- NEP-171: the house deed is `house.nearcarta.near`. Mint [FqYcLtmL…](https://nearblocks.io/txns/FqYcLtmLb7WM9vo83iMNyfSMiMnifSMLQJPJHwBzLtnu).
- Sign-in: email or a wallet on the setup page. The account id is saved in this browser and read by every shop panel.

## Tracks
Eight tracks. Each one is a building. The pin labels and the brown town are unchanged; the track name is on the shop card and under the shop title.

| Track | Building | What runs | Contract | Proof |
|---|---|---|---|---|
| DeFi | Ferry | One recorded NEAR Intents swap: 0.045 wNEAR became 0.177937 USDC. New quotes stay dry | `intents.near` | [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw) |
| Privacy | Mist Bank | The model call does not move NEAR. The TEE check is `judges/proofs/tee-check.json` | `board.nearcarta.near` | [JChWxmAN…](https://nearblocks.io/txns/JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy) |
| Autonomous Business | Chronicle, Toll Bridge | Chronicle reads one account and writes a local statement. It does not charge an entry. Toll asks the MPC signer | `board.nearcarta.near`, `toll.nearcarta.near` | chronicle [8WDqBeaN…](https://nearblocks.io/txns/8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR), toll allow [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz) |
| AI Security | Guardhouse | The charter refuses a payment over the cap and a payee off the list | `board.nearcarta.near` | over cap [CcPMX1Dt…](https://nearblocks.io/txns/CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF), off list [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) |
| Agent Economy | Town Hall | `set_rules`, `set_frozen` and `set_seal` on the visitor's own row. Deposit 0. The recorded rows are a reward and a refusal | `board.nearcarta.near` | reward [6UxwRmoE…](https://nearblocks.io/txns/6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h), refusal [Cp2rWatn…](https://nearblocks.io/txns/Cp2rWatnDBHRhbmGdrNqFbr14tg42TW4cAMTjp4Bsnu6) |
| Real-World Money | Payouts | The city room pays reviewed NEAR rows with `propose` under the row cap. An over-cap row is refused before any deposit. A foreign row is held. An invoice is a durable exact-dollar link | `board.nearcarta.near` | earlier propose [4jEjzpiY…](https://nearblocks.io/txns/4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia). New txs: see Payouts |
| Games | Vault Arena | A recorded arena payment and an over-cap refusal | `arena.nearcarta.near` | [AZWxqZns…](https://nearblocks.io/txns/AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht), [25LpJRFF…](https://nearblocks.io/txns/25LpJRFF6ugmRdF8eH7Rw7dpkMthQjG6XWXFyx9mqa6V) |
| Open | Your House | A house deed payment of 0.001 NEAR was allowed and 0.002 NEAR was refused | `house.nearcarta.near` | [83nyJmTW…](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26), [3Z4UAb6N…](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1) |

## Limits
The live board wasm has no access key, no `propose_batch` and no upgrade method. A row is closed with `close_charter`. The API does not sign mainnet. A Pay checkout asks for a deposit address of at most 0.20 USD and does not send the deposit. The payout room sends one `propose` per reviewed in-cap NEAR row and refuses an over-cap row before any deposit. The recorded payouts above are earlier single `propose` calls. A foreign row is held. An invoice is a durable `/pay/<id>` record and the API does not send the deposit. Owner costs, not signed: a ferry deposit of 0.20 USD (`node backend/scripts/ferry-live-swap.js` without `--live` prints the steps); three board proposes of 0.001 NEAR move 0.003 NEAR (`3000000000000000000000` yoctoNEAR) from the row. `set_rules`, `set_frozen` and `set_seal` attach a deposit of 0. The list is `node backend/scripts/spend-plan.js`.

## The town loop
Open the town, walk to a shop, and press the button. The Lamplighter asks. The charter allows or refuses. The chronicle lists the result with a nearblocks.io link. The chain stays in the proof drawer.

### Verify it yourself in 5 minutes
```
git clone https://github.com/nearcarta/nearcarta && cd nearcarta && npm ci
npm test                                   # 603 backend unit tests (600 pass, 3 skipped), offline
(cd contracts/oath && cargo test --lib)    # 122 charter unit tests
npm run verify:mainnet                     # re-reads the proof txs in shared/deployments/mainnet.json
```
Sandbox suites (local near-sandbox, no keys; this is what the `oath-sandbox` CI job runs):
```
cd contracts/oath   && cargo +1.86.0 near build non-reproducible-wasm --locked
cd ../reaper        && cargo +1.86.0 near build non-reproducible-wasm --locked --no-abi
cd ../oath          && cargo test --locked --test sandbox --test exploits --test props --test adversarial --test teardown
```

### Test counts (all passing)
| Suite | Tests |
|---|---|
| oath unit (`src/tests.rs`) | 122 |
| oath sandbox / exploits / adversarial / teardown / properties | 3 / 10 / 10 / 2 / 21 |
| toll, arena, townhall, house_nft, attested_check, charter_factory, charter_factory_lock, charter_board unit | 67, 17, 15, 16, 4, 23, 13, 15 |
| backend unit (`npm test`) | 470 (467 pass, 3 skipped) |
| browser e2e | 124 passed, 2 skipped, 1 flaky on retry. The skips need a partner key or a NEAR AI key |

The 2 skipped e2e tests need a 1Click partner key or a NEAR AI key; they are not faked offline. There is no published line-coverage figure. CI (`.github/workflows/ci.yml`) runs the backend tests, proof verify and build, every crate's unit tests, the oath and factory sandbox suites, and gitleaks.

### Security model
- The agent signs with a function-call key limited to the charter and `propose`/`propose_batch`; it cannot attach deposits, transfer, or call owner methods.
- The charter, not the agent, checks the payee, the per-payment cap, the daily budget and count, clause expiry and the nonce; it refuses on chain with a reason.
- Rule changes that widen what the agent may do wait behind the policy delay; code upgrades need `queue_upgrade` with the code hash first when a delay is set.
- The owner can freeze and can revoke the agent key. Served accounts have 0 full-access keys.

### Addresses (from `shared/deployments/`)
- Mainnet: `charter.nearcarta.near`, `toll.nearcarta.near`, `arena.nearcarta.near`, `house.nearcarta.near`, `townhall.nearcarta.near`. Allowed payment [JChWxmAN…](https://nearblocks.io/txns/JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy), over cap refused [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH). Full list: `shared/deployments/mainnet.json`.
- Board: `board.nearcarta.near`. One row per visitor. No access key.

### Teardown and refund plan
The visitor board returns a row through `close_charter` and the wasm stake through `reap` once no row is open: `docs/MAINNET_BOARD.md`. The unit test `a_failed_transfer_returns_the_balance_and_the_owner_cannot_reap_early` checks that `reap`. Close: [7XtAUzNq…](https://nearblocks.io/txns/7XtAUzNqmqQLNCC3Hrm2JXqTVciyrfvX918dnTWfXXcf).


Every shop is a real wallet app under your own on-chain charter.

**Judge path (Node 22, no keys).** `npm test` is offline. Mainnet is read-only: `curl` the API and `npm run verify:mainnet`. `near account list-keys` needs the NEAR CLI; Node 22 does not include it.
```
git clone https://github.com/nearcarta/nearcarta && cd nearcarta
npm ci
npm test            # unit tests, about 15 s
npm run verify:mainnet  # re-reads the proof txs in shared/deployments/mainnet.json; a refusal still counts
npm run verify:mainnet  # re-reads the proof txs in shared/deployments/mainnet.json; a refusal still counts
curl -s https://nearcarta-api.onrender.com/api/health
curl -s https://nearcarta-api.onrender.com/api/mainnet
npm run check-cited # every file, tx, account and hash the docs cite exists
```

A town of shops on NEAR. In every shop an AI agent (the Lamplighter) moves money, and each move is checked first by the charter (the `oath` contract on NEAR), which holds the agent's rules. Agents ask. The charter answers.

Deployed: https://nearcarta.vercel.app serves the pages, and `/api/*` is passed to the API on Render: https://nearcarta-api.onrender.com. The hackathon demo window runs through 2026-11-25. This page does not prove uptime. Example: `/api/health`, `/api/receipts`, `/api/mainnet`. `/api/health` returns `network.contracts` `mainnet`, `network.journey` `mainnet`, and `near.chain_id` `mainnet` (test `health names mainnet and has no trial block`). `/api/ai/tee` returns `ok: true`. General signing stays off (`signing: false`). A visitor charter is a row on `board.nearcarta.near` (`docs/MAINNET_BOARD.md`, deploy [CaZr8GmM…](https://nearblocks.io/txns/CaZr8GmMM83WUEESUShTiKtth8PWgxtRTesYGs1mkdpt)). `/ferry-widget` is the Pay page.

## For judges: open the transaction, see the charter's answer

### Mainnet
Open the tx. You should see the charter allow or refuse it. Links are https://nearblocks.io. Records: `shared/deployments/mainnet.json`, `judges/proofs/core-mainnet-deploy.json`, `judges/proofs/extras-mainnet-deploy.json`.

- Open the allowed payment [JChWxmAN…](https://nearblocks.io/txns/JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy). The agent paid 0.001 NEAR to `nearcarta.near`.
- Open the over-cap ask [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH). The charter refused 0.003 NEAR: `over_per_action_cap`.
- Open the toll's allowlisted signature [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz) and the unlisted refusal [B9FFjcSA…](https://nearblocks.io/txns/B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR). The derived Base address was unfunded, so the foreign tx was not broadcast.
- Open the arena payment [AZWxqZns…](https://nearblocks.io/txns/AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht) and the over-cap refusal [25LpJRFF…](https://nearblocks.io/txns/25LpJRFF6ugmRdF8eH7Rw7dpkMthQjG6XWXFyx9mqa6V).
- Open the house payment [83nyJmTW…](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26) and the refusal [3Z4UAb6N…](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1).
- Open the town hall reward [6UxwRmoE…](https://nearblocks.io/txns/6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h) and the refusal [Cp2rWatn…](https://nearblocks.io/txns/Cp2rWatnDBHRhbmGdrNqFbr14tg42TW4cAMTjp4Bsnu6).
- Visitor board `board.nearcarta.near` (one contract, one row per visitor, no access key, 86,762 bytes, 0.86762 NEAR stake returned by `reap`). Deploy [CaZr8GmM…](https://nearblocks.io/txns/CaZr8GmMM83WUEESUShTiKtth8PWgxtRTesYGs1mkdpt). `nearcarta.near` opened a row with a 0.01 NEAR fund; the row locked 0.00265 NEAR of storage [BUqfZMBT…](https://nearblocks.io/txns/BUqfZMBTnqU5f223FSDyufCzaVemvMCaWZ2iYXs4MJ4u), agent key bound [DqMrsEJj…](https://nearblocks.io/txns/DqMrsEJjd2wyiRh8tW25ZqK8MnG8Tk4rYW3XGuKTfiW7). Allowed: the agent-signed 0.001 NEAR to `townhall.nearcarta.near` [8WDqBeaN…](https://nearblocks.io/txns/8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR). Refused 0.003 NEAR `over_per_action_cap` [CcPMX1Dt…](https://nearblocks.io/txns/CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF) and `stranger.near` `receiver_not_allowlisted` [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ). `close_charter` returned the row stake and the 0.009 NEAR left [7XtAUzNq…](https://nearblocks.io/txns/7XtAUzNqmqQLNCC3Hrm2JXqTVciyrfvX918dnTWfXXcf); `get_config` then reads `rows: 0`. Re-run: `backend/scripts/board-proof-mainnet.js`. Record: `shared/deployments/mainnet.json` `board`.
- **A real visitor, start to finish (browser, mainnet, real NEAR).** At `nearcarta.vercel.app/setup` an email sign-in made the implicit account `8e20273e…74e661c8`. `nearcarta.near` funded it with 0.08 NEAR [A3SqsmD6…](https://nearblocks.io/txns/A3SqsmD6CcDvD4qdRAxJrDn1gUUFzcVC3ErVdQZVveeu) and 0.03 NEAR [9Hz9yVar…](https://nearblocks.io/txns/9Hz9yVarJAow2cU1SAap6EEdyJfuCM5QwGDHfAZdABV8). The visitor picked rules on the page (cap 0.005 NEAR, daily 0.01 NEAR, 3 payments a day, receivers `charter.nearcarta.near` and `toll.nearcarta.near`) and opened a row with a 0.02 NEAR deposit [6xMQyXcc…](https://nearblocks.io/txns/6xMQyXcczLjxymmrYfBhFDuRy9MpFV62CviqdYHrnTdQ). Step 7 "Try it": the request signed by the visitor's agent key for 0.001 NEAR was paid [4jEjzpiY…](https://nearblocks.io/txns/4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia); the one for 0.01 NEAR (twice the cap) failed on chain with `over_per_action_cap` [AsZUd9mZ…](https://nearblocks.io/txns/AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx). Then, with no wallet popup at all: the row was topped up with `fund` 0.005 NEAR [34QArpij…](https://nearblocks.io/txns/34QArpijENRcPPYhWPpvVhmbhxXr1jPaBpE6xGNAZ4Lj), and the agent's own function-call key (limited to `propose` on the board) signed a 0.001 NEAR request that was paid [BecizuUP…](https://nearblocks.io/txns/BecizuUP6eN4eQnRtYajq6wTudY8pX4gRSVMZMticz1s). A second no-popup 0.001 NEAR request was paid too [5A3QBy7T…](https://nearblocks.io/txns/5A3QBy7Tp3q3tiJa9BQFP7Caniw54uBo5HVVr5MsWMe4). All six are signed by the visitor account and re-read by `npm run verify:mainnet` (record: `shared/deployments/mainnet.json` `board.visitor_run`). Fund NEAR once in `/setup`. City Ferry then has three different steps. The stamp is Ask charter: the session key calls `propose` for 0.005 NEAR to `charter.nearcarta.near` at 30 Tgas, outcomes ok, with no wallet popup [Fy1BKPbr…](https://nearblocks.io/txns/Fy1BKPbrWSJ2z9wgSazsrjGhXHm3Rk7YzEhfwhJ95bvV). That stamp is not the swap. The session settle is about 0.05 wNEAR on NEAR to USDC on NEAR, and checkout still refuses a quote over 0.20 USD: `POST /api/ferry/checkout`, then `propose_call` on `wrap.near` (`near_deposit`, `storage_deposit`, `ft_transfer`) when the row cap holds the wrap. The boat says delivered only after 1Click status is SUCCESS. No wallet popup, and the visitor is not asked to send USDC on Base. Guest Load cargo is a demo and does not say delivered. USDC on Base is optional Pay (`/ferry-widget`): you send that deposit yourself, and 1Click can refuse it below the corridor bridge minimum even when the USD amount is at most 0.20, with no deposit address and the boat not delivered. A session swap reached SUCCESS (see the Ferry session swap below). Tests: `dock send quotes 0.05 wNEAR on NEAR to USDC and typing does not`, `a session load plans a deposit and a guest load stays a demo`, `USDC on Base is you-send, and NEAR under the cap is propose_call with no wallet`. Code: `app/design/D8_shops/js/shopui.js`, `app/src/panels/deep.js`, `app/src/panels/ferry-settle.js`.
- Ferry: one real NEAR Intents swap on mainnet. 0.045 wNEAR ($0.1809) in, 0.177937 USDC out to `nearcarta.near` after a 0.005027 USDC withdraw fee. Wrap [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw), deposit `ft_transfer` [A6pqkcd3…](https://nearblocks.io/txns/A6pqkcd3onJcAbJ2gCBNByejDkThARRkVshoXFB8zGkz), USDC withdraw from `intents.near` [Be1ttdbm…](https://nearblocks.io/txns/Be1ttdbmiKhqwxpstP33HefWUp3o1A8RwKosdcK2mquk). Intent hashes `aybjMQLNbHajyPerDhE65udeMLCRcsUCouGPsgjEvmJ`, `DaD8b4EyxbyQstKszWXRWFLB5FHzAUw52n7bqVgXMSTe`. Record: `shared/deployments/mainnet.json` `ferry_intents`.
- Ferry, city session swap with no wallet popup (mainnet, visitor `8e20273e…74e661c8`). The agent's session key signed `propose_call` on `board.nearcarta.near` for every step: `near_deposit` 0.05 NEAR [ruXXQXay…](https://nearblocks.io/txns/ruXXQXayPzWNqXE6K3ByE2HTMbRRxwKbQkzhh1wjLwp) (wrap.near kept 0.00125 to register the board, so 0.04875 wNEAR arrived), `storage_deposit` [HYtd4YiN…](https://nearblocks.io/txns/HYtd4YiNwD1pDNCiXoBkCyQnZarW6YsJzpCb9GMrs7wW), a first `ft_transfer` of 0.05 refused by wrap.near for low balance [BndmCHQS…](https://nearblocks.io/txns/BndmCHQSQKucAh8KqqEGY4FQ56CinkfoKk7NuMVLjLGB), then a re-quote to the 0.04875 wNEAR the board held: [BFEbgQkF…](https://nearblocks.io/txns/BFEbgQkFmwtj4ieXXLrBiMwReMqXyBDbStfcn7STCDrm) and the `ft_transfer` to the 1Click deposit [5vUC4zn1…](https://nearblocks.io/txns/5vUC4zn1PjLxLk57tTpG1fP98WkPcFgbPFEKdC3tvK2S). 1Click reported SUCCESS and the visitor now holds 0.174899 USDC on NEAR (`ft_balance_of` on `17208628…36133a1`). The boat showed delivered and the seal.
- Ferry, AI agent in the city chat, mainnet: the visitor typed `Swap 0.05 wNEAR on NEAR to USDC`, the agent answered "Asking the charter under your cap. No wallet.", and the session key ran `propose_call` steps on `board.nearcarta.near` with no wallet popup: [CY47nQJG…](https://nearblocks.io/txns/CY47nQJGeWhzZmFqXsEv2Tnf8NpjCYhH4uQSWRLzSJbi), [3ManZC3x…](https://nearblocks.io/txns/3ManZC3xpzd9c6iTEM7sCzraas6DM3JSPGfx7SfAbjft), [Gyn611i1…](https://nearblocks.io/txns/Gyn611i1gvbteCpCtzzGxK3czRtfLhNCcf6nM3hrTGt5). 1Click status for deposit `4612544e…2ca57e` is SUCCESS (0.05 wNEAR, $0.1865 in; intents `FFieVBET…`, `DsdNaxWy…`). The visitor's USDC on NEAR went from 0.174899 to 0.359730.
- Ferry, cross-chain from NEAR to Base with no wallet popup (mainnet, visitor `8e20273e…74e661c8`): the visitor picked USDC on Base and typed a Base address in Receive at. The tray reused 0.05 wNEAR already in the row, the session key ran `propose_call` steps [9Nhv9pQM…](https://nearblocks.io/txns/9Nhv9pQML9AYpkTYVGFHHeHNjSc8bow2M8cHKdY1P98h) and [AJxxwngS…](https://nearblocks.io/txns/AJxxwngS7CSUk7RxsDxXzwDvKfzUuh5iYto4xWJgM981), 1Click reported SUCCESS, and 0.179713 USDC arrived on Base at `0xBDfC…0034` [0xe23f332d…](https://basescan.org/tx/0xe23f332d4ce42bc918eaf20db48b4645373df527db2e66671f56bb246592f1ea) (quote 0.180145).
- Ferry in the city tray, cross-chain to Base, after the delivered and seal fix: 0.05 wNEAR became 0.180409 USDC at `0xBDfC…0034`, with no wallet popup. The session key ran [7fvFqxxh…](https://nearblocks.io/txns/7fvFqxxhYoxKc8x9oe1FTun1uqs5wapp5ym1LHwNETe), [CXyha4bS…](https://nearblocks.io/txns/CXyha4bSqUabTWH7w9QtpTDc5xGwJdKsnFSpjriaH1Qe), [5kb9rtTA…](https://nearblocks.io/txns/5kb9rtTAgW7QN2pNyyPo5P6LDV6sdjcFUi3Beeiib7sU). 1Click reported SUCCESS and the Base delivery is [0x1e55eae7…](https://basescan.org/tx/0x1e55eae78492ae9b0ca552d5f1032fd7000360698675cdf277465b1487c3626d). The boat read far bank, delivered.
- Ferry AI agent in the city, cross-chain to Base: a typed sentence (swap 0.05 wNEAR to USDC on base to an address) ran the same Load cargo function as the button and delivered 0.18057 USDC at `0xBDfC…0034`, with no wallet popup. The session key ran [6L29V63H…](https://nearblocks.io/txns/6L29V63HXDkCAmqybwbZqYxfTyxTDydwUwSrJEfnP6kP) and [8jcbYZPM…](https://nearblocks.io/txns/8jcbYZPMTKQKnakj8PeXVHX4fGrTEt2tB5s9aCqZac8o). 1Click reported SUCCESS and the Base delivery is [0xda4a4e7b…](https://basescan.org/tx/0xda4a4e7b890ce77c01cf7424014d4394817e1b007f7b8d6b586306af67b1ff6a).
- `curl https://nearcarta-api.onrender.com/api/receipts`. You should see one object shape for `near`, `chain-signatures`, `intents` and `near-ai`. The dry intents row has `"decision":"dry"` and `"tx":null`. A checkout adds another intents row whose `tx` is the deposit address. Code: `shared/rails/receipts.js`. Test: `every rail uses the same receipt keys`.

### Where the spend gate is, and what a receipt is
The gate is the charter contract (`contracts/oath`, `propose` at line 667). The agent holds only a function-call key for `propose` and `propose_batch`. It cannot transfer and it cannot change the rules. `GET /api/receipts` returns every rail in one shape: `rail`, `network`, `what`, `to`, `amount`, `asset`, `decision`, `reason`, `decided_by`, `tx`, `url`, `checks`.

- NEAR transfer. The receipt is the `propose` tx. Allowed or refused, with the reason. Mainnet: [JChWxmAN…](https://nearblocks.io/txns/JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy), [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH).
- Chain signatures. The receipt is the NEAR tx that asked the MPC signer. An address off the list is refused before a signature. Mainnet: [B9FFjcSA…](https://nearblocks.io/txns/B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR).
- Intents. A dry quote has no deposit address and no tx. `decision` is `dry`. The city session uses NEAR already on the visitor row: checkout, then `propose_call` on `wrap.near` when the row cap holds about 0.05 wNEAR, and the boat says delivered only after status is `SUCCESS`. Pay (`/ferry-widget`) is the optional you-send rail: a deposit address only after the charter allows the recipient, and only for at most 0.20 USD. That receipt’s `tx` is the deposit address, then the chain tx once status is `SUCCESS`. You send those Pay tokens yourself. A 1Click bridge minimum can refuse the quote before any address exists. The recorded swap command is optional Pay, not the city session: `node backend/scripts/ferry-live-swap.js --live --amount 0.2 --from USDC@base --to USDC@near --refund-to 0xYOURADDRESS`.
- NEAR AI. The receipt is the model job. Each job is at most 160 tokens. The day stops at $0.05 or 300 calls (`GET /api/agent/budget`). The call is not sent past that cap. The NEAR the job can move is still the charter's cap. TEE check: [tee-check.json](judges/proofs/tee-check.json).

### Why the charter is a contract
A key with a gas allowance can still be told to pay the wrong account, or to pay an allowed account too often. The charter checks the payee, the per-payment cap, the daily budget and the daily count, and writes the refusal on chain. The agent cannot edit those rules. Evidence: the over-cap refusal [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH) and the TEE check [tee-check.json](judges/proofs/tee-check.json). The model call does not move the NEAR.

## What it is
An on-chain charter for AI agents that spend money. A person writes the agent's rules (who it may pay, how much per payment and per day, when it must ask) into a NEAR contract, the charter (`contracts/oath`). The agent holds only a function-call key that can call `propose` and `propose_batch`. The contract checks each payment the agent proposes: allowed payments are sent, the rest are refused on chain with a reason, or held until the owner approves (NEP-519 yield). Humans only set the constraints; the agent acts inside them.

## The problem
An agent with a wallet key can be talked into paying anyone: a fake invoice, a prompt-injected recipient, a look-alike account, many small payments under a cap. Checks that live in the agent's own code or prompt fail when the agent is fooled. The charter puts the check in a contract the agent cannot change, so a fooled agent still cannot pay outside the rules.

## Try it in a browser
1. Open https://nearcarta.vercel.app and press *Sign in*. The setup page uses a mainnet account and real NEAR. A personal charter is a row on `board.nearcarta.near`. On Try it, Add NEAR to the charter puts that amount on the row in one approval; `close_charter` returns it.
2. Walk into a shop and press its button. Each signed step shows its tx as a link to nearblocks.io. `/design/D8_shops/?shop=<house|toll|ferry|bank|guard|arena|hall|payouts>` opens that room in the town (`/?shop=<id>`), which is the only tray.

| Shop | Press | See |
|---|---|---|
| House | *Set your agent's rules* | Your own row on `board.nearcarta.near`. The row key calls `propose`. The town charter key calls `propose` and `propose_batch` |
| Toll Bridge | *Pay 0.001 NEAR* | A 0.001 NEAR pass to `toll.nearcarta.near`. The chain-signature proofs are recorded separately. The foreign chain was not paid from this gate. Recorded allow [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz) |
| Ferry | *Get quote* for about 0.05 wNEAR on NEAR to USDC on NEAR, then *Load cargo* | Fund NEAR once in `/setup`. Ask charter is the stamp [Fy1BKPbr…](https://nearblocks.io/txns/Fy1BKPbrWSJ2z9wgSazsrjGhXHm3Rk7YzEhfwhJ95bvV), not the swap. A session Load cargo settles with `propose_call` when the quote is at most 0.20 USD and the row cap holds the wrap. The boat says delivered only after SUCCESS. Guest Load cargo is a demo. Pay (`/ferry-widget`) is optional and you send that deposit yourself. Session swap SUCCESS: 0.04875 wNEAR to 0.174899 USDC [5vUC4zn1…](https://nearblocks.io/txns/5vUC4zn1PjLxLk57tTpG1fP98WkPcFgbPFEKdC3tvK2S) |
| Mist Bank | Paste a card CSV or type *which charges look like waste in my list?*, then *Apply tighter limits* | The file is read in the browser. Amounts stay in their own currency. The agent names the merchants in the loaded statement, or asks for one. An empty model sentence is not verified, and the page checks the ed25519 signature itself. Live tighten is blocked until the board session can call it. Tx: (assistant adds the nearblocks link) |
| Guardhouse | Type an account and press *Check this account* | Age, code hash, lookalike, denylist and any recorded refusal, each with a sentence. A recorded refusal links the mainnet tx |
| Vault Arena | Write a scam, *Send the scam* | The NEAR AI model (`z-ai/glm-5.3-flash`) reads it and proposes a payment; a payment outside your rules is refused on chain. Six walls, points and a leaderboard |
| Payouts | *Pay reviewed rows*, or ask the AI Agent "Pay reviewed rows" | Each in-cap NEAR row is one `propose` on `board.nearcarta.near`. Over the row cap, the row is refused before any deposit. A foreign row is held. An invoice link stays on the receive account written at creation. Nothing is marked paid until 1Click status is `SUCCESS` |
| Town Hall | *Change my row* | `set_rules`, `set_frozen` and `set_seal` on your own row. Deposit 0. A preview reads the new cap back |
| Chronicle | Open `/?shop=chronicle`. Type an account and press Show timeline. Choose Timeline, Statement, or Verify | The timeline lists that account’s rows, or says there are no rows. Write statement makes a local summary and does not sign. Anchor downloads the bundle and says the live anchor is blocked. Export CSV is off when there are no rows. Verify rejects a changed statement. No entry fee. Live anchor tx: (coordinator adds the nearblocks link) |

The live path is a visitor's own row on `board.nearcarta.near`. Town Hall writes `set_rules` on that row.

| Shop | Code | Test | Mainnet |
|---|---|---|---|
| Ferry quote and status | `app/src/ferry-catalog.js` `pickBest` | `two ferry quotes mark the larger amount out` | recorded swap [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw). A new deposit was not sent |
| Guardhouse check | `app/src/guard-score.js` | `a guard check explains every signal` | refused payee [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) |
| Chronicle search | `app/src/chronicle-feed.js` | `chronicle search, filter, export and verify` | allowed [8WDqBeaN…](https://nearblocks.io/txns/8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR) |
| Chronicle ledger | `app/src/chronicle-loop.js` `accountRows` | `an unrelated account keeps its own live rows and does not borrow the owner feed` | same recorded allow. Live anchor tx: (coordinator adds the nearblocks link) |
| Chronicle statement | `app/src/chronicle-audit.js` `verifyNearAi` | `an unrelated account keeps its own live rows and does not borrow the owner feed` | no new spend. The live anchor is blocked until Board v2 |
| Toll address | `app/src/toll-derive.js` | `the toll key hashes to the recorded Base address` | allow [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz) |
| House deed | `app/src/deed-control.js` | `a deed move refuses the previous holder` | allow [83nyJmTW…](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26), refuse [3Z4UAb6N…](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1) |
| Town Hall row | `app/shops/hall/row.js` | `a hall preview reads the new cap back and builds gas-only calls` | reward [6UxwRmoE…](https://nearblocks.io/txns/6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h). `set_rules` was not sent |
| Payouts | `app/src/panels/payouts-plan.js` `classifyPayroll` | `plan: classifyPayroll sends the in-cap row, refuses the big one before deposit, holds USDC` | earlier allowed [4jEjzpiY…](https://nearblocks.io/txns/4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia). New payroll txs are not in this commit |
| Room load | `app/src/room-error.js` | `a room error never shows the engine text` | no new spend |
| Town intro | `app/design/D9_world/js/main.js` `story` | `the 3D story starts without the flat overlay` | no new spend |

### Chronicle
An account auditor for the Autonomous Business loop. Open the city (`/?shop=chronicle`). Type an account. The tray reads `GET /api/chronicle/live?account=`, `GET /api/chronicle?owner=`, `GET /api/ledger` and `GET /api/mainnet`. The live route is a public read for any account. It tries nearblocks.io, then FastNEAR (`api.fastnear.com` and `tx.main.fastnear.com`), then NEAR RPC `EXPERIMENTAL_tx_status`. A failed or unanswered read is not cached. An answered read is cached for 60 seconds. The health line names the source that answered. `NEARBLOCKS_API_KEY` is optional and is not written into the response. The browser holds no key. Test: `a nearblocks 429 falls back to fastnear and the key stays out of the body`. A plain execution failure is `failed` and the tray says Failed on chain. Refused stays a Nearcarta board or rule refusal. Test: `a chain failure is not called a refusal`. Each source names its count or its gap, including a missing rules version, a missing wrap.near transfer, and a 1Click match only when an `intents.near` transfer is on the page. An empty index says there are no rows. Recorded proofs are added only when the deployment names that account, and they are not called a live index. The read is cached so a warm answer does not call the index again.

Timeline, Statement, and Verify sit on one card. The icon card is account to ledger. Write statement asks NEAR AI Cloud when `NEARAI_CLOUD_API_KEY` is set, and the prompt contains the canonical bundle digest. The response carries the model signature and the attestation fields. Verify re-checks the ed25519 signature, the request hash, and that digest. It says the Intel DCAP quote, TCB, and RTMR3 are not verified in the browser, and that the raw response bytes are not re-hashed there. With no key, or when the preflight or the signature does not come back, the statement is a labelled local fallback. Anchor asks for consent before a private note is committed. The commitment is `sha256(salt:note)`. The raw note hash is not published. The live board contract has no anchor method, so Anchor downloads the bundle and says the live anchor is blocked. Nothing is signed on chain. Export CSV counts delivered, refunded, and attempted.

```
git clone https://github.com/nearcarta/nearcarta && cd nearcarta && npm ci
npm test
node --test backend/test/unit/chronicle-depth.test.js backend/test/unit/chronicle-live.test.js
curl -s https://nearcarta-api.onrender.com/api/chronicle
curl -s https://nearcarta-api.onrender.com/api/ledger
```
Recorded allow: [8WDqBeaN…](https://nearblocks.io/txns/8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR). Live anchor tx: (coordinator adds the nearblocks link).

## Tracks and the hints we use
- DeFi (Ferry): one recorded NEAR Intents swap. New quotes stay dry.
- Privacy (Mist Bank): a browser audit of a card CSV or a named sample. The agent answers a free-form waste, duplicate, subscription, or limit question from the loaded statement and names the merchants, or asks for a statement instead of using a sample. A model audit sends those lines to NEAR AI, does not store them, and an empty model sentence is not verified. The page checks the ed25519 signature itself. It does not move NEAR. Live tighten is blocked. Confidential pay stays off.
- Autonomous Business (Chronicle, Toll Bridge): Chronicle audits one account and does not charge an entry. Toll asks the MPC signer at `toll.nearcarta.near`.
- AI Security (Guardhouse): spending limits and a policy engine in the charter. The town charter agent key calls `propose` and `propose_batch`. Every served account has 0 full-access keys. The agent key cannot unfreeze the charter.
- Agent Economy (Town Hall): `set_rules` on the visitor's own row. Deposit 0.
- Real-World Money (Payouts): reviewed in-cap NEAR rows pay with `propose`. Over-cap rows are refused before any deposit. See the Payouts section. New txs are not filled in yet.
- Games (Vault Arena): a recorded payment and an over-cap refusal.
- Open (Your House): a NEP-171 deed. The city tray is Deed / Vaults / Heirs. The gold button and the AI Agent call the same check, and neither signs. A charter `propose` is not a spend from the house. Check-in, heir changes, and a foreign send wait on a board call that acts as the holder, and on a Toll signer this shop does not copy. The address path uses the house contract as predecessor so it can stay with the deed. Inheritance (`house_check_in`, guardian approval, cancel, release, epoch, vault caps) is in `contracts/house_nft` and is not on `house.nearcarta.near` (that account has no access key). No new mainnet tx was sent. Recorded purse allow [83nyJmTW…](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26), refuse [3Z4UAb6N…](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1). Inheritance tx: not sent. Base receipt: not sent. Heir same-address receipt: not sent.

## Payouts

The city door is the shop. `/shops/payouts/` is the backup list: it can prepare rows, and Pay there does not send, because that page does not hold the session key.

Payroll calls `propose` on `board.nearcarta.near`, one reviewed in-cap NEAR row at a time, with the session key from `/setup`. No wallet popup. The amount has to fit the row's `per_action_cap` (read with `get_charter`, not `get_rules` on the visitor). An amount over that cap is refused before any deposit. A foreign or held-asset row is held until a board can prove the effect. It is not sent.

An invoice is one durable record (`POST /api/payouts/invoices`, then `/pay/<id>`). The receive account and the amount are written when the link is created. A query on the payer page cannot change them. The quote is `EXACT_OUTPUT`. `ANY_INPUT` is not requested. Checkout may ask 1Click for a deposit address. The API does not send the deposit. A second checkout reuses the same address. The room says paid only when 1Click status is `SUCCESS`. A hosted abuse ceiling, when `PAYOUTS_USD_CEILING` is set, refuses before that quote. It is not a product price. There is no fixed 0.20 USD payouts cap.

`close_charter` on the visitor's row returns the unspent balance. There is no new payouts contract. A zero-NEAR account still needs NEP-141 `storage_deposit` on the USDC contract before it can hold USDC. A meta-transaction pays gas. It does not pay that storage. This shop does not claim a funded storage sponsor.

The accountant CSV lists `source,destination,asset,amount,fee,refund,status,tx`. A row is `paid` only after `SUCCESS`. Anything else says `not sent`.

Earlier proposes, not from this payroll run: allowed [4jEjzpiY…](https://nearblocks.io/txns/4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia), refused [AsZUd9mZ…](https://nearblocks.io/txns/AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx).

New txs, filled by the live run:

- Pay 1: (assistant adds the nearblocks link)
- Pay 2: (assistant adds the nearblocks link)
- Pay 3: (assistant adds the nearblocks link)
- Refusal: (assistant adds the nearblocks link)
- Invoice: (assistant adds the status or the nearblocks link)

## Toll Bridge

The city door is the way in. The all-shops list still links to `/shops/toll/`. When the town is running, that link calls `window.__openCityShop('toll')` and opens the room. `window.__enterToll` is the fallback. The standalone page is the backup.

The card has three tabs: Pass, Proof, and Split. Pay 0.001 NEAR is on Pass. Check signature is on Proof. Split has no extra button. The AI Agent takes “Pay the toll”, “Check signature”, and “Show policy”, including the short forms “pay toll”, “pass the bridge”, and “cross”. The same three lines are chips in the chat. Enter and the Send button both send. A line the agent does not know stays in the box and shows a hint.

A pass is one `propose` on `board.nearcarta.near` paying `toll.nearcarta.near` 0.001 NEAR, under the visitor’s row cap. The same button does that call. In the city, a session with no board row does not open a wallet. No wallet opens when the session key can call `propose`. A different amount, a missing allowlist entry, a frozen or expired row, a short balance, or a daily budget that cannot hold 0.001 NEAR stops before any signature. While the charter is asked, the button says “Asking the charter under your cap…”. The boom lifts on every allowed pass, including one sent from the chat. A refusal shows a seal and clears on the next action. The chat then says the pass was paid, names the new row balance, and links the transaction.

Check signature reads the visitor’s latest NEAR pass to `toll.nearcarta.near` (`GET /api/toll/pass/:hash`). It does not treat the recorded owner allow as that pass. A signature, and a NEAR pass, are not a payment on Base. Paid on Base is reserved for a success receipt the page has actually read. This room does not broadcast.

`GET /api/toll/live` reads `policy` and the recent `get_tx` rows. A view that fails comes back as `{ ok: false }` so the card can say the policy did not answer. The gate route is unchanged.

Recorded on mainnet: allowed [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz), refused [B9FFjcSA…](https://nearblocks.io/txns/B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR). Passes from this room: [3frACAL1…](https://nearblocks.io/txns/3frACAL1EU4APBcAME8gNg1xw4uKSnXc81hj2c56Jdon) and [CwcBGcw9…](https://nearblocks.io/txns/CwcBGcw9FUt7FmpaVdgSPVKK1d9krWt4TE1z46WUfHez). Each one is 0.001 NEAR to `toll.nearcarta.near`. Neither is a Base payment.

Teardown is `close()` with 1 yocto, predecessor the owner, and the balance returns to `nearcarta.near`. `backend/scripts/toll-teardown.js` prints that call and does not send it. This change does not redeploy the toll contract. If `on_signed` recovers an address that does not match the recorded foreign address, that callback panics; the earlier sign receipt can still stand. The room never calls `pay`, `pay_for`, or `sign`.

Chronicle lists a pass from this room beside the recorded rows. The pass is stored in localStorage and merged into the chronicle list, so a reload keeps it.

Live check, at most 0.06 NEAR (the pass itself is 0.001):

1. Open the town and use the Toll Bridge door, not the standalone page first.
2. On Pass, say “Pay the toll” to the agent, or press Pay 0.001 NEAR.
3. Expect one mainnet transaction to `toll.nearcarta.near` for 0.001 NEAR, then the boom. The line says the pass was paid and links the transaction. It also says the receipt is not a Base payment.
4. On Proof, press Check signature. It checks your latest pass to `toll.nearcarta.near`. The card does not say the toll was paid on Base.
5. If `toll.nearcarta.near` is missing from the row, or the cap is under 0.001 NEAR, the seal shows and the boom stays down. The next command clears the seal.
6. Open Chronicle. The new pass is listed with the recorded allow and the recorded refusal.

## Run it (2 minutes)
```
npm ci
npm test                 # 603 unit tests (600 pass, 3 skipped)
npm run verify:mainnet   # re-reads the proof txs in shared/deployments/mainnet.json
npm start &              # API on :8787; without ARENA_AGENT_KEY no route signs
NEARCARTA_API= npm run build && node app/serve.mjs &   # UI on :5173; empty NEARCARTA_API = same-origin /api (a plain build points at the hosted API, which CORS blocks from localhost)
npx playwright install chromium && npm run e2e   # 127 browser tests: 124 passed, 2 skipped, 1 flaky
```
Optional: `ONECLICK_PARTNER_KEY` enables confidential quotes. `NEARAI_CLOUD_API_KEY` enables the live NEAR AI TEE check (`npm run tee`; non-billable). `NEARBLOCKS_API_KEY` is an optional nearblocks.io key for the Chronicle timeline. Without them the public paths still run.

## Check each shop
The payments below are in `shared/deployments/mainnet.json`, re-read by `npm run verify:mainnet`.

| Shop | Do | See | Proof |
|---|---|---|---|
| Ferry | Open the recorded swap | 0.045 wNEAR became 0.177937 USDC | [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw) |
| Mist Bank | `curl -X POST $API/api/mistbank/verify -H content-type:application/json -d '{"amount":"<zatoshi>","salt":"<32 hex>"}'` | Auditor only. The amount, the salt and the viewing key are never served or committed. An auditor given the key out of band reads the opening from the encrypted memo and gets `matches: true`; any other amount gives `matches: false`. The charter stores the commitment; it does not cap or move the Zcash amount | unit "the opening check matches the recorded commitment and rejects any other amount"; "the public record carries no viewing key, amount or salt" |
| Mist Bank | `curl $API/api/mistbank \| grep -cE "uview\|salt=\|zats"` | `0`: the public view is the commitment, the tx links, the street check and the charter check. One payee account per payout, so a viewing key opens one payout only | unit "the public record carries no viewing key, amount or salt" |
| Mist Bank | `curl $API/api/mistbank/street/17a9a84d758b4feebea5d8fc2c556a95cd0778506cce791c7de23c4a08e0b497` | `amount_hidden: false`, reason `pool_crossing_reveals_amount`: a faucet tx that leaks its amount, for contrast | unit "a pool-crossing payment leaks its amount through the value balance" (`backend/test/unit/mistbank.test.js`) |
| Mist Bank city | Open the town, enter Mist Bank. Paste a card CSV or type *audit my spending and tell me the biggest waste*. Then *Apply tighter limits*, *Verify the TEE*, and *Show the attestation file* | A card file is read in the browser. Amounts stay in their own currency, and the cap line names its NEAR price source. The proof log keeps counts, not the lines. A model audit sends those lines to NEAR AI and does not store them. A failed attestation step is named. An empty model sentence is not verified. The page checks the ed25519 signature from the signed text, the raw signature, and the signer. A looser cap, a reset, and an unfreeze are refused. Live tighten is blocked: nothing is signed and no wallet opens. `GET /api/bank/proof` returns hashes and the attestation summary. Request and response bytes are not stored. `POST /api/ai/prove` stays off unless `AI_PROVE_ENABLED=1`. `close_charter` returns the visitor's row; `reap` runs after the last row and returns the contract balance to `nearcarta.near` (`docs/MAINNET_BOARD.md`). This page does not deploy a contract. Tx: (assistant adds the nearblocks link) | unit `an audit line picks the sample and a miss shows the hint`; `a local audit drops the statement and a looser cap is refused`; `a card csv keeps its currency and names the biggest waste`; `an empty model sentence is not verified and the browser checks the signature`; `an envelope signature verifies without sending a completion`; `a hardware attestation is the live proof when completions are off`; `the billable prove route stays gated and the bank proof route does not` (`backend/test/unit/bank-shop.test.js`) |
| Board | Open the off-list refusal | `receiver_not_allowlisted`. Nothing was paid | [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) |
| Ferry | UI `#ferry` → *Get dry quote* (USDC on Base → ZEC) | 3 PASS rows: 1Click ed25519 signature, echo guard, dry. The Zcash recipient is decoded as an Orchard-only unified address, so the ZEC is shielded into Zcash's Ironwood pool (NU6.3, ZIP 258). Code: `backend/src/ferry.js`, `zcash.js` | e2e "ferry: dry 1Click quote USDC (Base) -> ZEC to a shielded address passes all checks" |
| Pay | Open `/ferry-widget`, leave the amount at 0.2, press Pay | The charter is read first. A deposit address appears only when that recipient is allowlisted and the signed quote is at most 0.20 USD. The receipt uses the same keys, rail `intents`, and `tx` is the deposit address. Code: `backend/src/ferry-checkout.js`, `app/src/ferry-pay.js` | e2e "ferry checkout: mocked 1Click returns a deposit address only after the charter allows it"; unit `a refused recipient never asks 1Click, and an allowed one returns a deposit address` |
| Ferry | City tray (Skip to shop), session on, Get quote for about 0.05 wNEAR on NEAR, then Load cargo | Checkout at most 0.20 USD, then `propose_call` on `wrap.near` when the row cap holds it. No wallet. The boat says delivered only after SUCCESS. A quote 1Click rejects (bridge minimum, or over 0.20 USD) shows the reason, hides the refuse seal, and does not say delivered. Guest Load cargo stays a demo. Ask charter is the 0.005 NEAR stamp, not the swap. Code: `app/design/D8_shops/js/shopui.js`, `app/src/panels/deep.js`, `app/src/panels/ferry-settle.js` | unit `a session load plans a deposit and a guest load stays a demo`; unit `dock send quotes 0.05 wNEAR on NEAR to USDC and typing does not`; [Fy1BKPbr…](https://nearblocks.io/txns/Fy1BKPbrWSJ2z9wgSazsrjGhXHm3Rk7YzEhfwhJ95bvV) |
| House | City door, or `/shops/house/`. Deed / Vaults / Heirs. One gold button: I'm alive, Send from house, or Cancel release. The agent uses that same check | No wallet and no charter spend. I'm alive builds `propose_call_as` for `house_session_check_in` from that visitor's row. The board writes `row_owner`. A foreign send is a hold until `confirm_hold`. Over the row cap or the vault cap shows a seal and does not sign. A prepared send says live broadcast is blocked. Cinema does not play. `node scripts/house-deploy.js` prints the redeploy and does not sign. Code: `app/src/panels/house-room.js`, `app/src/panels/house-agent.js`, `app/src/house-board.js`, `scripts/house-deploy.js` | unit `a house pay over the cap is refused before any signature`; unit `a visitor check-in builds propose_call_as from that visitor's row`; unit `an eth key becomes the toll address method`; recorded allow [83nyJmTW…](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26). Inheritance tx: not sent. Base receipt: not sent. Heir same-address receipt: not sent |
| Ferry | Set the recipient to `t1Nk7gi97dKeY7WAU3ryJnSDCoqp7VDaXzC` | "public on Zcash" warning | e2e "ferry: a transparent Zcash address is flagged as public" |

# 603 unit tests (600 pass, 3 skipped):
Proof rows (54/54 expected).
`judges/proofs/e2e-vercel.json`: 20 passed, 1 skipped.
`contracts/oath` is the agent charter (Rust, near-sdk). 122 unit tests live in its source. The visitor board is `contracts/charter_board` (15 tests, rustc 1.86).
