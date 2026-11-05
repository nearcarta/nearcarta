# Nearcarta

[![ci](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml)
![tests](https://img.shields.io/badge/backend%20unit%20tests-362%20pass%2C%201%20skipped-brightgreen)

**Thesis: the agent proposes, the NEAR charter decides.** The AI agent holds only a function-call key for `propose`; every payment is checked by the `oath` contract, which allows it, refuses it on chain with a reason, or holds it for the owner.

## For AI judges: claims, code, tests, txs
Each claim names the code, the test that pins it, and a tx you can open. Test names are exact; run them with the commands below. Guide for agents: [AGENTS.md](AGENTS.md).

| Claim | Code | Test | On chain |
|---|---|---|---|
| The agent key can only call `propose`; it cannot call owner methods or move NEAR | `contracts/oath/src/lib.rs` `propose` (line 667) | `adv_agent_key_cannot_call_owner_methods_or_transfer`, `adv_wrong_signer_cannot_propose` (`tests/adversarial.rs`) | full-access key deleted [71Zio28g…](https://nearblocks.io/txns/71Zio28gV3yubD5DecGtkguWzWdfix8brcKFy13d3zzt) |
| A payee off the allowlist, over the cap or over the daily budget is refused | `clause_checks` (line 1164) | `adv_allowlist_cap_and_budget`; property tests in `tests/props.rs` | over cap [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH); payee off the list [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) |
| A non-widening rule change never permits more | `is_widening` / policy delay (line 368) | property tests in `tests/props.rs` | board `set_rules` is the visitor's own row |
| Replays, stale versions, expired or unknown clauses are refused | `propose` | `adv_replay_same_nonce_is_rejected`, `adv_stale_version_expired_and_unknown_clause`, `adv_clause_expiry_refuses_after_deadline` | |
| Only the owner changes the rules | owner checks in `lib.rs` | `adv_non_owner_cannot_change_rules` | |
| Over-cap waits for the owner (NEP-519 yield) | `resolve_escalation` (line 888) | `exploit_f4_escalation_after_freeze_and_allowlist_removal` (`tests/exploits.rs`), `c5_escalation_band_is_held_not_yielded` (`src/tests.rs`) | board over cap refused [CcPMX1Dt…](https://nearblocks.io/txns/CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF) |
| Freeze stops the agent; revoke removes its key | `freeze` (line 624), `revoke_agent` (line 616) | `adv_freeze_refuses_then_owner_unfreezes`, `adv_revoked_agent_key_is_gone` | agent key added [Frp44yFG…](https://nearblocks.io/txns/Frp44yFGSAh9vi2w4dmV4wnDH5MBktvX7N2xyAcPRJDP) |
| A list of payments is one at a time, not all-or-nothing | `contracts/charter_board` `propose` | `try tiles stay disabled when no payments are left today` | allowed [4jEjzpiY…](https://nearblocks.io/txns/4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia), refused [AsZUd9mZ…](https://nearblocks.io/txns/AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx) |
| Closing a board row returns its stake | `contracts/charter_board` `close_charter` | `a_failed_transfer_returns_the_balance_and_the_owner_cannot_reap_early` | close [7XtAUzNq…](https://nearblocks.io/txns/7XtAUzNqmqQLNCC3Hrm2JXqTVciyrfvX918dnTWfXXcf) |
| The API rejects bad input, refuses unknown CORS origins, never echoes the caller IP, and refuses a body over 16 KB | `backend/src/server.js`, `backend/src/app.js` `bodyLimit` | `backend/test/unit/api-contract.test.js` (`an oversized JSON body is refused before it is read`) | |
| Start here opens setup. After a charter exists, the same pin opens the charter office | `app/design/D9_world/index.html` `#rulesBtn`, `app/design/D9_world/js/main.js` `paintStart` | e2e `town pin opens setup and each step renders` | |
| Sign in on /setup uses a mainnet account and real NEAR. A personal charter row opens on `board.nearcarta.near` | `shared/setup/path.js` `setupJourney`, `contracts/charter_board`, `docs/MAINNET_BOARD.md` | `the default setup path is mainnet and does not offer the faucet or a charter factory`, `a trial flag does not open a guest path` | board deploy [CaZr8GmM…](https://nearblocks.io/txns/CaZr8GmMM83WUEESUShTiKtth8PWgxtRTesYGs1mkdpt) |
| The public leaderboard lists factory charters except `shared/vault/denied-accounts.json` | `backend/src/vault.js` `publicPlayers` | `a factory charter appears unless we created that account` | |
| Pay reads the charter, then asks 1Click for a deposit address of at most 0.20 USD. The page does not send the deposit | `backend/src/ferry-checkout.js` `openCheckout`, `app/src/ferry-pay.js` | `a refused recipient never asks 1Click, and an allowed one returns a deposit address` | the owner runs `node backend/scripts/ferry-live-swap.js --live` for one swap; this repo does not send it |
| The model cannot switch the payee or the amount the visitor named. The charter still refuses an off-list payee | `backend/src/agent.js` `propose` | `a model that invents a payee is discarded for the words`, `a model that raises the amount is kept to the amount in the message` | off-list refusal [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) |
| One receipt shape covers a NEAR payment, a chain-signature toll, a dry Intents quote and a capped model job | `shared/rails/receipts.js` `receiptsBody`, `GET /api/receipts` | `every rail uses the same receipt keys` | allowed [JChWxmAN…](https://nearblocks.io/txns/JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy), refused [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH) |
| A house deed payment of 0.001 NEAR was allowed and 0.002 NEAR was refused | `shared/deployments/mainnet.json` `extras.house` | `the recorded house deed payments are the allow and the refusal` | allowed [83nyJmTW…](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26), refused [3Z4UAb6N…](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1) |

## Technologies
- NEAR contract: `contracts/charter_board`, live at `board.nearcarta.near`. The visitor signs `open_charter`, `set_rules`, `propose`.
- Chain signatures: `toll.nearcarta.near` asked the MPC signer. Allow [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz). Refusal [B9FFjcSA…](https://nearblocks.io/txns/B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR).
- NEAR Intents: one recorded swap, 0.045 wNEAR to 0.177937 USDC. [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw). New quotes stay dry.
- NEAR AI Cloud: `GET /api/ai/tee` checks the attestation. The model call does not move NEAR. Proof file `judges/proofs/tee-check.json`.
- NEP-171: the house deed is `house.nearcarta.near`. Mint [FqYcLtmL…](https://nearblocks.io/txns/FqYcLtmLb7WM9vo83iMNyfSMiMnifSMLQJPJHwBzLtnu).
- Sign-in: email or a wallet on the setup page. The account id is saved in this browser and read by every shop panel.

## Limits
The live board wasm has no access key and no upgrade method. A row is closed with `close_charter`. A shared DAO is not built. The API does not sign mainnet. A Pay checkout asks for a deposit address of at most 0.20 USD and does not send the deposit. Payouts are one at a time, each at most 0.005 NEAR, at most three a day.

## The town loop
Open the town, walk to a shop, and press the button. The Lamplighter asks. The charter allows or refuses. The chronicle lists the result with a nearblocks.io link. The chain stays in the proof drawer.

### Verify it yourself in 5 minutes
```
git clone https://github.com/nearcarta/nearcarta && cd nearcarta && npm ci
npm test                                   # 363 backend unit tests (362 pass, 1 skipped), offline
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
| toll, arena, townhall, house_nft, attested_check, charter_factory, charter_factory_lock, charter_board unit | 67, 17, 15, 16, 4, 23, 13, 12 |
| backend unit (`npm test`) | 372 (371 pass, 1 skipped) |
| browser e2e against the live site | 22 passed, 12 skipped. The skipped tests need a funded key |

The 12 skipped e2e tests sign real transactions and need a funded wallet key or an opt-in flag (`GUARD_E2E`, `VAULT_E2E`, `VAULT_AI_E2E`, `HALL_FILE`, `HOUSE_*_KEY_FILE`, a partner key, or the arena attack switch); they are not faked offline. There is no published line-coverage figure. CI (`.github/workflows/ci.yml`) runs the backend tests, proof verify and build, every crate's unit tests, the oath and factory sandbox suites, and gitleaks.

### Security model
- The agent signs with a function-call key limited to the charter and `propose`/`propose_batch`; it cannot attach deposits, transfer, or call owner methods.
- The charter, not the agent, checks the payee, the per-payment cap, the daily budget and count, clause expiry and the nonce; it refuses on chain with a reason.
- Rule changes that widen what the agent may do wait behind the policy delay; code upgrades need `queue_upgrade` with the code hash first when a delay is set.
- A DAO or owner can freeze; the owner can revoke the agent key. Served accounts have 0 full-access keys.

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

## For judges: do X, see Y

### Mainnet
Open the tx. You should see the charter allow or refuse it. Links are https://nearblocks.io. Records: `shared/deployments/mainnet.json`, `judges/proofs/core-mainnet-deploy.json`, `judges/proofs/extras-mainnet-deploy.json`.

- Open the allowed payment [JChWxmAN…](https://nearblocks.io/txns/JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy). The agent paid 0.001 NEAR to `nearcarta.near`.
- Open the over-cap ask [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH). The charter refused 0.003 NEAR: `over_per_action_cap`.
- Open the toll's allowlisted signature [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz) and the unlisted refusal [B9FFjcSA…](https://nearblocks.io/txns/B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR). The derived Base address was unfunded, so the foreign tx was not broadcast.
- Open the arena payment [AZWxqZns…](https://nearblocks.io/txns/AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht) and the over-cap refusal [25LpJRFF…](https://nearblocks.io/txns/25LpJRFF6ugmRdF8eH7Rw7dpkMthQjG6XWXFyx9mqa6V).
- Open the house payment [83nyJmTW…](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26) and the refusal [3Z4UAb6N…](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1).
- Open the town hall reward [6UxwRmoE…](https://nearblocks.io/txns/6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h) and the refusal [Cp2rWatn…](https://nearblocks.io/txns/Cp2rWatnDBHRhbmGdrNqFbr14tg42TW4cAMTjp4Bsnu6).
- Visitor board `board.nearcarta.near` (one contract, one row per visitor, no access key, 86,762 bytes, 0.86762 NEAR stake returned by `reap`). Deploy [CaZr8GmM…](https://nearblocks.io/txns/CaZr8GmMM83WUEESUShTiKtth8PWgxtRTesYGs1mkdpt). `nearcarta.near` opened a row with a 0.01 NEAR fund; the row locked 0.00265 NEAR of storage [BUqfZMBT…](https://nearblocks.io/txns/BUqfZMBTnqU5f223FSDyufCzaVemvMCaWZ2iYXs4MJ4u), agent key bound [DqMrsEJj…](https://nearblocks.io/txns/DqMrsEJjd2wyiRh8tW25ZqK8MnG8Tk4rYW3XGuKTfiW7). Allowed: the agent-signed 0.001 NEAR to `townhall.nearcarta.near` [8WDqBeaN…](https://nearblocks.io/txns/8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR). Refused 0.003 NEAR `over_per_action_cap` [CcPMX1Dt…](https://nearblocks.io/txns/CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF) and `stranger.near` `receiver_not_allowlisted` [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ). `close_charter` returned the row stake and the 0.009 NEAR left [7XtAUzNq…](https://nearblocks.io/txns/7XtAUzNqmqQLNCC3Hrm2JXqTVciyrfvX918dnTWfXXcf); `get_config` then reads `rows: 0`. Re-run: `backend/scripts/board-proof-mainnet.js`. Record: `shared/deployments/mainnet.json` `board`.
- **A real visitor, start to finish (browser, mainnet, real NEAR).** At `nearcarta.vercel.app/setup` an email sign-in made the implicit account `8e20273e…74e661c8`. `nearcarta.near` funded it with 0.08 NEAR [A3SqsmD6…](https://nearblocks.io/txns/A3SqsmD6CcDvD4qdRAxJrDn1gUUFzcVC3ErVdQZVveeu) and 0.03 NEAR [9Hz9yVar…](https://nearblocks.io/txns/9Hz9yVarJAow2cU1SAap6EEdyJfuCM5QwGDHfAZdABV8). The visitor picked rules on the page (cap 0.005 NEAR, daily 0.01 NEAR, 3 payments a day, receivers `charter.nearcarta.near` and `toll.nearcarta.near`) and opened a row with a 0.02 NEAR deposit [6xMQyXcc…](https://nearblocks.io/txns/6xMQyXcczLjxymmrYfBhFDuRy9MpFV62CviqdYHrnTdQ). Step 7 "Try it": the request signed by the visitor's agent key for 0.001 NEAR was paid [4jEjzpiY…](https://nearblocks.io/txns/4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia); the one for 0.01 NEAR (twice the cap) failed on chain with `over_per_action_cap` [AsZUd9mZ…](https://nearblocks.io/txns/AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx). Then, with no wallet popup at all: the row was topped up with `fund` 0.005 NEAR [34QArpij…](https://nearblocks.io/txns/34QArpijENRcPPYhWPpvVhmbhxXr1jPaBpE6xGNAZ4Lj), and the agent's own function-call key (limited to `propose` on the board) signed a 0.001 NEAR request that was paid [BecizuUP…](https://nearblocks.io/txns/BecizuUP6eN4eQnRtYajq6wTudY8pX4gRSVMZMticz1s). A second no-popup 0.001 NEAR request was paid too [5A3QBy7T…](https://nearblocks.io/txns/5A3QBy7Tp3q3tiJa9BQFP7Caniw54uBo5HVVr5MsWMe4). All six are signed by the visitor account and re-read by `npm run verify:mainnet` (record: `shared/deployments/mainnet.json` `board.visitor_run`).
- Ferry: one real NEAR Intents swap on mainnet. 0.045 wNEAR ($0.1809) in, 0.177937 USDC out to `nearcarta.near` after a 0.005027 USDC withdraw fee. Wrap [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw), deposit `ft_transfer` [A6pqkcd3…](https://nearblocks.io/txns/A6pqkcd3onJcAbJ2gCBNByejDkThARRkVshoXFB8zGkz), USDC withdraw from `intents.near` [Be1ttdbm…](https://nearblocks.io/txns/Be1ttdbmiKhqwxpstP33HefWUp3o1A8RwKosdcK2mquk). Intent hashes `aybjMQLNbHajyPerDhE65udeMLCRcsUCouGPsgjEvmJ`, `DaD8b4EyxbyQstKszWXRWFLB5FHzAUw52n7bqVgXMSTe`. Record: `shared/deployments/mainnet.json` `ferry_intents`.
- `curl https://nearcarta-api.onrender.com/api/receipts`. You should see one object shape for `near`, `chain-signatures`, `intents` and `near-ai`. The dry intents row has `"decision":"dry"` and `"tx":null`. A checkout adds another intents row whose `tx` is the deposit address. Code: `shared/rails/receipts.js`. Test: `every rail uses the same receipt keys`.

### Where the spend gate is, and what a receipt is
The gate is the charter contract (`contracts/oath`, `propose` at line 667). The agent holds only a function-call key for `propose` and `propose_batch`. It cannot transfer and it cannot change the rules. `GET /api/receipts` returns every rail in one shape: `rail`, `network`, `what`, `to`, `amount`, `asset`, `decision`, `reason`, `decided_by`, `tx`, `url`, `checks`.

- NEAR transfer. The receipt is the `propose` tx. Allowed or refused, with the reason. Mainnet: [JChWxmAN…](https://nearblocks.io/txns/JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy), [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH).
- Chain signatures. The receipt is the NEAR tx that asked the MPC signer. An address off the list is refused before a signature. Mainnet: [B9FFjcSA…](https://nearblocks.io/txns/B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR).
- Intents. A dry quote has no deposit address and no tx. `decision` is `dry`. Pay (`/ferry-widget`) asks for a deposit address only after the charter allows the recipient, and only for at most 0.20 USD. That receipt’s `tx` is the deposit address, then the chain tx once status is `SUCCESS`. You send the tokens yourself. One real swap: `node backend/scripts/ferry-live-swap.js --live --amount 0.2 --from USDC@base --to USDC@near --refund-to 0xYOURADDRESS`.
- NEAR AI. The receipt is the model job. Each job is at most 160 tokens. The day stops at $0.05 or 300 calls (`GET /api/agent/budget`). The call is not sent past that cap. The NEAR the job can move is still the charter's cap. TEE check: [tee-check.json](judges/proofs/tee-check.json).

### Why the charter is a contract
A key with a gas allowance can still be told to pay the wrong account, or to pay an allowed account too often. The charter checks the payee, the per-payment cap, the daily budget and the daily count, and writes the refusal on chain. The agent cannot edit those rules. Evidence: the over-cap refusal [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH) and the TEE check [tee-check.json](judges/proofs/tee-check.json). The model call does not move the NEAR.

## What it is
An on-chain charter for AI agents that spend money. A person writes the agent's rules (who it may pay, how much per payment and per day, when it must ask) into a NEAR contract, the charter (`contracts/oath`). The agent holds only a function-call key that can call `propose`. The contract checks each payment the agent proposes: allowed payments are sent, the rest are refused on chain with a reason, or held until the owner approves (NEP-519 yield). Humans only set the constraints; the agent acts inside them.

## The problem
An agent with a wallet key can be talked into paying anyone: a fake invoice, a prompt-injected recipient, a look-alike account, many small payments under a cap. Checks that live in the agent's own code or prompt fail when the agent is fooled. The charter puts the check in a contract the agent cannot change, so a fooled agent still cannot pay outside the rules.

## Try it in a browser
1. Open https://nearcarta.vercel.app and press *Sign in*. The setup page uses a mainnet account and real NEAR. A personal charter is a row on `board.nearcarta.near`.
2. Walk into a shop and press its button. Each signed step shows its tx as a link to nearblocks.io. The same rooms open directly at `/design/D8_shops/?shop=<house|toll|ferry|bank|guard|arena|hall|payouts>`.

| Shop | Press | See |
|---|---|---|
| House | *Set your agent's rules* | Your own row on `board.nearcarta.near`, with a propose-only agent key |
| Toll Bridge | *Pay 0.001 NEAR* | One payment to `toll.nearcarta.near`. A refusal pays nothing. Recorded allow [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz) |
| Ferry | *Get quote*, then *Ask my agent to swap*, or open *Pay from any chain* | A live 1Click price with its signature checked. The shop can then pay a NEAR stand-in through your charter. Pay (`/ferry-widget`) creates a deposit address only after the charter allows the recipient, at most 0.20 USD |
| Mist Bank | *Send 0.01 NEAR privately* (fixed note sizes), then *Verify the seal*; *Verify the TEE now* | The charter memo carries a commitment and the seal matches the chain; the send comes with a NEAR AI TEE check that uses the commitment as its nonce (*Verify the TEE now* uses a fresh random one). The ZEC payout is mainnet only |
| Guardhouse | *Try to trick my agent* (poisoned invoice), then *Let it knock anyway* | The payee check blocks before signing; sent anyway, the charter refuses on chain: "you never allowed that account" |
| Vault Arena | Write a scam, *Send the scam* | The NEAR AI model (`z-ai/glm-5.3-flash`) reads it and proposes a payment; a payment outside your rules is refused on chain. Six walls, points and a leaderboard |
| Payouts | List up to three payments | One at a time, each at most 0.005 NEAR. Not all-or-nothing |
| Town Hall | *Apply to my row* | `set_rules` on your own row. Gas only. A shared DAO is not built |

The live path is a visitor's own row on `board.nearcarta.near`. A shared DAO is not built. Town Hall writes `set_rules` on that row.

## Tracks and the hints we use
- `security`: spending limits and a policy engine in a contract. FUNCTION CALL KEYS: the agent key can only call `propose`; every served account has 0 full-access keys. TEE ATTESTATION: NEAR AI Cloud Intel TDX and NVIDIA quotes checked live. Scam detection: the payee check and the Arena scam set. Reputation counted from on-chain refusals.
- `business`: humans only set the constraints; the agent pays inside them. Cross-chain: NEAR Intents via the recorded swap, and Chain Signatures via `toll.nearcarta.near`.
- `privacy`: NEAR AI Cloud TEE check (PRIVATE AI, TEE, NEAR AI CLOUD). The model call does not move the NEAR.

## Run it (2 minutes)
```
npm ci
npm test                 # 363 unit tests (362 pass, 1 skipped)
npm run verify:mainnet   # re-reads the proof txs in shared/deployments/mainnet.json
npm start &              # API on :8787; without ARENA_AGENT_KEY no route signs
NEARCARTA_API= npm run build && node app/serve.mjs &   # UI on :5173; empty NEARCARTA_API = same-origin /api (a plain build points at the hosted API, which CORS blocks from localhost)
npx playwright install chromium && npm run e2e   # 34 browser tests: 22 run, 12 skip without wallet keys
```
Optional: `ONECLICK_PARTNER_KEY` enables confidential quotes. `NEARAI_CLOUD_API_KEY` enables the live NEAR AI TEE check (`npm run tee`; non-billable). Without them the public paths still run.

## Check each shop: do X, see Y
The payments below are in `shared/deployments/mainnet.json`, re-read by `npm run verify:mainnet`.

| Shop | Do | See | Proof |
|---|---|---|---|
| Ferry | Open the recorded swap | 0.045 wNEAR became 0.177937 USDC | [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw) |
| Mist Bank | `curl -X POST $API/api/mistbank/verify -H content-type:application/json -d '{"amount":"<zatoshi>","salt":"<32 hex>"}'` | Auditor only. The amount, the salt and the viewing key are never served or committed. An auditor given the key out of band reads the opening from the encrypted memo and gets `matches: true`; any other amount gives `matches: false`. The charter stores the commitment; it does not cap or move the Zcash amount | unit "the opening check matches the recorded commitment and rejects any other amount"; "the public record carries no viewing key, amount or salt" |
| Mist Bank | `curl $API/api/mistbank \| grep -cE "uview\|salt=\|zats"` | `0`: the public view is the commitment, the tx links, the street check and the charter check. One payee account per payout, so a viewing key opens one payout only | unit "the public record carries no viewing key, amount or salt" |
| Mist Bank | `curl $API/api/mistbank/street/17a9a84d758b4feebea5d8fc2c556a95cd0778506cce791c7de23c4a08e0b497` | `amount_hidden: false`, reason `pool_crossing_reveals_amount`: a faucet tx that leaks its amount, for contrast | unit "a pool-crossing payment leaks its amount through the value balance" (`backend/test/unit/mistbank.test.js`) |
| Board | Open the off-list refusal | `receiver_not_allowlisted`. Nothing was paid | [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) |
| Ferry | UI `#ferry` → *Get dry quote* (USDC on Base → ZEC) | 3 PASS rows: 1Click ed25519 signature, echo guard, dry. The Zcash recipient is decoded as an Orchard-only unified address, so the ZEC is shielded into Zcash's Ironwood pool (NU6.3, ZIP 258). Code: `backend/src/ferry.js`, `zcash.js` | e2e "ferry: dry 1Click quote USDC (Base) -> ZEC to a shielded address passes all checks" |
| Pay | Open `/ferry-widget`, leave the amount at 0.2, press Pay | The charter is read first. A deposit address appears only when that recipient is allowlisted and the signed quote is at most 0.20 USD. The receipt uses the same keys, rail `intents`, and `tx` is the deposit address. Code: `backend/src/ferry-checkout.js`, `app/src/ferry-pay.js` | e2e "ferry checkout: mocked 1Click returns a deposit address only after the charter allows it"; unit `a refused recipient never asks 1Click, and an allowed one returns a deposit address` |
| Ferry | Set the recipient to `t1Nk7gi97dKeY7WAU3ryJnSDCoqp7VDaXzC` | "public on Zcash" warning | e2e "ferry: a transparent Zcash address is flagged as public" |
Earlier rehearsal notes are in [docs/archive/TESTNET_REHEARSAL.md](docs/archive/TESTNET_REHEARSAL.md). They are history. The town above is mainnet.

# 363 unit tests (362 pass, 1 skipped):
Proof rows (76/76 expected).
`judges/proofs/e2e-vercel.json`: 22 passed, 12 skipped.
`contracts/oath` is the agent charter (Rust, near-sdk). 122 unit tests live in its source. The visitor board is `contracts/charter_board` (12 tests, rustc 1.86).
