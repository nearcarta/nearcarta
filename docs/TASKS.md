# Nearcarta master task list (single source of truth; tick each with commit + test + screenshot)

## Owner items (original 9)
- [ ] O1 Premium cinematic onboarding. The lock factory is retired: one oath wasm per visitor does not fit `nearcarta.near`, and a global contract's storage burn does not come back (`docs/MAINNET_FACTORY.md`). The visitor path is one board, `contracts/charter_board`: a row per account (allowlist, caps, window, freeze, sealed rule, ed25519 agent key), at most 0.02 NEAR, refunded by `close_charter`. `reap` deletes the account only when no row is open (`docs/MAINNET_BOARD.md`). `backend/scripts/deploy-mainnet-board.js` prints the exact yoctoNEAR cost and does not sign unless the owner passes `--live` with `NEAR_MAINNET_SIGNER_KEY`. It refuses a plan over 1 NEAR. The board is live at `board.nearcarta.near` (deploy `CaZr8GmMM83WUEESUShTiKtth8PWgxtRTesYGs1mkdpt`, near-sdk 5.27, rustc 1.86, `c75c48c`). `/setup` sends `open_charter` when `NEXT_PUBLIC_MAINNET=1`. The live wasm has no `force_close`; the replacement plan is B1. With `NEXT_PUBLIC_MAINNET=1` and status `deployed`, the same page opens the row (test `the public mainnet flag hides the guest and opens a charter row only after the board is deployed`). `460c8ef`. Contract tests at that commit: `cargo test --lib` in `contracts/charter_board` (11 pass, including `an_allowed_payment_moves_only_that_visitors_balance`, `refusals_leave_both_rows_untouched`, `close_refunds_the_row_stake_and_the_unspent_balance`). Cost test: `the board wasm deploys for at most 1 NEAR and the state size matches the contract`. Dry run of the script on this wasm: total `796631993114499300000000` yoctoNEAR (0.79663 NEAR), peak `806119931144993000000000` yoctoNEAR (0.80612 NEAR).
- [x] O2 Sign in is the only primary CTA. `5a01d11`, `1a72d4e`. Test: e2e `town pin opens setup` expects zero "Connect wallet".
- [x] O3 Character creator: six looks, dyes, outfits, name, live portrait, saved in `nearcarta.hero.v1`, shown by `app/design/D9_world/js/hero-town.js`. `5a01d11`. Screenshot: `setup-character-1440.png`.
- [x] O4 Leaderboard lists factory charters and hides `shared/vault/denied-accounts.json`. `20ca3ae`. Test: `a factory charter appears unless we created that account`.
- [x] O5 Back to town is on setup, vault, hall, console, judges, ledger, loop, 404, and the shop interiors. The town page is the town.
- [x] O6 Default journey is mainnet. Guest trial is a secondary control and is the only path that says testnet when `NEXT_PUBLIC_MAINNET` is unset. `46d66db`, `20ca3ae`, `2f3fe00`. Tests: `the default setup path is mainnet and does not offer the faucet or a charter factory`, `the public mainnet flag hides the guest and opens a charter row only after the board is deployed`. Shop progress lines say "Signing on NEAR". The flagged build hides the guest control, so that journey does not show the word testnet.
- [x] O7 Proof drawer sits above the top-right account row (`app/build.mjs` hides `#acct` while the drawer is open). Town labels and the "Click a building" hint: `20ca3ae`.
- [x] O8 Logo is `app/src/brand/mark.svg`, favicon `/favicon.svg`, og image `/brand/og.png`.
- [x] O9 Agent binding and extra model fields cannot change the payment. `110019b`, `1a72d4e`. Tests: `a model that invents a payee is discarded for the words`, `extra model fields cannot change the payment method`. npm audit highs are zod inside Privy (no zod 3 fix) and are not force-upgraded.
- [x] O10 `render.yaml` plan is `starter`. `1a72d4e`.

## Judge signals (done in cce69a8, keep)
- [x] J1 README mainnet do-X-see-Y first
- [x] J2 /api/receipts uniform
- [x] J3 inference cap
- [x] J4 why-contract section
- [x] J5 demo up to Nov 25. The README no longer promises uptime. The window is still 2026-11-25. `2f3fe00`.
- [x] J6 PR #1 fast-forwarded onto main (`1a72d4e`). Later commits stay on main. Leaderboard is O4 (`20ca3ae`).
- [x] J7 `/api/health` returns `network.contracts: mainnet` and `network.trial: testnet`. `d363c91`. Test: `health names mainnet contracts and the testnet trial`. Live read of https://nearcarta-api.onrender.com/api/health on this run returned that object. `near.chain_id` is `testnet` because that height is the API's testnet RPC.

## Prod audit (my screenshots)
- [x] A1 Landing story is "The town runs on NEAR mainnet." Shop badges say mainnet. `20ca3ae`.
- [x] A2 `/console` is a judges page. Mainnet receipts first. No account chip and no testnet-block PASS. `20ca3ae`.
- [x] A3 Larger pin labels, overlap nudge, "Click a building" hint. `20ca3ae`.
- [x] A4 Judges menu is "For judges". The account chip is the character name plus a short id. `20ca3ae`.
- [x] A5 A shop without a charter still shows what it does and the mainnet proof. `20ca3ae`.
- [x] A6 One button, Sign in, until the shop can run. `20ca3ae`.
- [x] A7 The shop button is no longer left on "Opening…". `20ca3ae`. Direct shop URLs reached their labels in this run's screenshots.
- [x] A8 Town Hall strips markup and lists every proposal. `20ca3ae`.
- [x] A9 Amount icons attach only to a number plus a symbol, so "kept on NEAR" and "1 USDC" no longer gain a broken gap. `20ca3ae`.
- [x] A10 Mist and Ferry lead with plain words. Technical rows sit under Technical details. `20ca3ae`.
- [x] A11 `/loop` shows the five steps before you press the button. `20ca3ae`. Test: `loop page: timer, the two real calls, a plain plan, routes`.
- [x] A12 Ledger shop names match the town. Refusals are 0 NEAR, not a fake payment. The model line says it is operator spend. `20ca3ae`.
- [x] A13 Setup fund on the mainnet path can continue at 0 NEAR. The address shown is short. Earlier steps are clickable. `20ca3ae`.
- [x] A14 "Open the charter office" stays `/shops/vault/`. `hero-town.js` no longer rewrites it to `/setup`.

## Sign-in fixes (owner, do not redo)
- [x] A15 `/sign` uses the city card and readable text. `3c3055e` (`app/house/sign.jsx`, `app/src/sign/brand.css`).
- [x] A16 Finish sign-in runs from a click so the window opens in front. `8704b0c`.
- [x] A17 Verify shows progress, then a finish button. `8704b0c`. Test ids: `setup-status`, `setup-finish`.
- [x] A18 One session for `/setup` and the rest of the site. "Use another email" stops the click from falling through. `8704b0c`.

## Ferry universal checkout (after above)
- [x] F1 Pay (`/ferry-widget`, `app/src/ferry-pay.js`) lets the payer pick a chain. `POST /api/ferry/checkout` reads the charter first (`backend/src/ferry-checkout.js` `charterGate`: allowlist, cap, daily budget, daily count, window, frozen, sealed rule). Only then does it ask 1Click for a deposit address, and only if the signed amount is at most 0.20 USD. The receipt is rail `intents`; `tx` is the deposit address, then the chain tx once status is SUCCESS. `quote()` stays dry. `2333267`. Tests: `a refused recipient never asks 1Click, and an allowed one returns a deposit address`, `an amount over 0.20 USD never asks for a deposit address`, e2e `ferry checkout: mocked 1Click returns a deposit address only after the charter allows it`. The owner runs `node backend/scripts/ferry-live-swap.js --live --amount 0.2 --from USDC@base --to USDC@near --refund-to 0xYOURADDRESS`. That script was not run here, and it does not send the deposit. Live `https://nearcarta.vercel.app/ferry-widget` returned 200 on this run.
- [x] F2 Ferry’s proof now shows the mainnet charter allow and the over-cap refusal, and the shop links to Pay. The Guardhouse proof points at Mist Bank’s “Verify the TEE now” check. Toll, arena, house and town hall already show their mainnet allow and refuse txs. Mist Bank stays a testnet shielded payout plus that TEE check. No further shop gap can be closed without a new mainnet transaction or a contract deploy. `2333267`.

## README and judge-path gaps
- [x] W1 Live `/api/health` returns `network.contracts` `mainnet` and `network.trial` `testnet`. `near.chain_id` stays `testnet`. README says so. `2f3fe00`.
- [x] W2 The 22 passed, 12 skipped e2e run is testnet wallets. README says there is no mainnet browser e2e. `2f3fe00`.
- [x] W3 Sign-in is mainnet. A personal charter row is not sent until `board.status` is `deployed` and `NEXT_PUBLIC_MAINNET=1`. The guest trial is labeled testnet only while that flag is off. `2f3fe00`.
- [x] W4 AGENTS.md says the town contracts are on mainnet, the API does not sign mainnet, and the factory script is owner-run. `2f3fe00`.
- [x] W5 `vault_runner.charter` on the live health response is the testnet arena charter. README says that key does not sign mainnet. `2f3fe00`.
- [x] W6 One count: `npm test` is 369 tests, 368 pass, 1 skipped. The old 660 and 350 figures are gone. `2f3fe00`.
- [x] W7 README says `hackathon-submission` is not pushed and the compare link 404s until the owner tags it. The tag was not pushed. `2f3fe00`.
- [x] W8 `https://nearcarta.vercel.app/ferry-widget` returned 200 on this run. The route stays in `vercel.json`.
- [x] W9 The 90.9% coverage badge is removed. There is no coverage proof file. `2f3fe00`.
- [x] W10 "stays up through 2026-11-25" is now the hackathon window, not an uptime proof. `2f3fe00`.
- [x] W11 The 6.659 NEAR figure is the note in `judges/proofs/core-rehearsal-teardown-testnet.json`, not a number `npm run verify` recomputes. `2f3fe00`.
- [x] W12 `npm run verify:mainnet` re-read 40/40 txs in `shared/deployments/mainnet.json` from the archival RPC. Refusals count as found. `2f3fe00`. Record: `judges/proofs/mainnet-proof-check.json`.
- [x] W13 README says `near account list-keys` needs the NEAR CLI. Node 22 does not include it. `2f3fe00`.
- [x] W14 The judge path includes `curl /api/health`, `curl /api/mainnet`, and `npm run verify:mainnet`. `2f3fe00`.
- [x] W15 Same as W12. `npm run verify` stays the testnet proof read.

## Board follow-ups
- [x] B1 Owner `force_close(visitor)` on `contracts/charter_board` refunds that visitor's storage stake and unspent balance, then `reap` can run. `a9b2b2d`. Test: `force_close_refunds_that_visitor_and_then_the_owner_can_reap` (`cargo +1.86.0 test --lib`, 12 pass). The `STATE` layout is unchanged, so an in-place wasm would keep every row. The live account `board.nearcarta.near` has no access key and no upgrade method (code hash `6aBm6TugZzge9uHDpSsr6pG7XPfZm22JoZ8XZxknRGsa`), so this method is not on the live wasm. The owner path is in `docs/MAINNET_BOARD.md`: visitors `close_charter`, `reap` at zero rows, then a new account with a near-sdk 5.27 / rustc 1.86 wasm. This repo does not sign that.
- [x] B2 `/api/health` reports the journey on mainnet. `near.chain_id` is `mainnet`. The trial RPC is `trial.chain_id`, and that block is omitted when `NEXT_PUBLIC_MAINNET=1`. `307d245`. Test: `health names mainnet contracts and the testnet trial`. The Town Hall bond line no longer says testnet (`app/shops/hall/main.js`). Comments in `app/shops/vault/wallet.js`, `app/house/house.js`, and `app/design/D8_shops/js/tollsplit.js` no longer say it. The labeled guest trial still does, when the flag is unset (O6).
- [x] B3 `scripts/test-contracts.sh` runs `charter_board` with the channel in `contracts/charter_board/rust-toolchain.toml` (1.86.0). CI installs rustc 1.86 only for that crate. `b854f16`. The lock factory stays on 1.95. The near-sdk 5.30 wasm failed on mainnet (`failed_deploy_tx` `4mq8P3jugnatzbbc9VzDbufCBpyj27TxwK4w3L7nTPCX`).
- [x] B4 The cold chronicle read and `refreshBoard` no longer assert a tight wall clock. A busy event loop delayed the timer once, then the same test passed alone. `71a8809`. Tests: `a cold read slower than the cold wait answers timeout at once; the read keeps going and serves the next call`, `refreshBoard answers within its wait and keeps the last fill result`.

## Done when
Playwright shots of every setup step and every shop at 1440 and 390 are in `/opt/cursor/artifacts/screenshots/` (`setup-signin` through `setup-try`, `shop-house`, `shop-toll`, `shop-ferry`, `shop-bank`, `shop-guard`, `shop-arena`, `shop-hall`, `shop-payouts`, plus `ferry-widget`, `console`, and `town`). They are not committed. The unit suite is `npm test`. `cargo +1.86.0 test --lib` in `contracts/charter_board` covers the row. CI runs the backend suite and that crate on push to main. O1 stays open for the cinematic onboarding. The board account is already live.

## A19-A25 Mainnet paths for a visitor's board charter (Nov 5)
Constraints for all: reuse `board.nearcarta.near` (live wasm has no access key and no upgrade method, so only its existing methods: open_charter, set_rules, set_frozen, set_seal, set_agent, fund, propose, close_charter, get_charter, get_config); no new per-visitor contracts; every tx <= 0.005 NEAR.
- [ ] A19 Mist Bank verify on mainnet: the NEAR leg is a board `propose` (<=0.005) to an allowlisted receiver; backend verifies it by tx hash via mainnet RPC `EXPERIMENTAL_tx_status` (signer = visitor, receiver = board, transfer receipt amount and payee match), then checks the Zcash testnet leg as today. No new contract, 0 extra NEAR.
- [ ] A20 Hall changes to your own charter on mainnet: the visitor signs board `set_rules` / `set_frozen` / `set_seal` on their own row (gas only, 0 deposit); Hall reads the result back with `get_charter`. Replaces the testnet charter view.
- [ ] A21 Hall DAO actions on mainnet: no DAO on mainnet. Cheapest honest path: keep the DAO vote on the testnet DAO, labeled, and show the visitor's own-rule change (A20) as the mainnet action. A single shared mainnet DAO is a new (non per-visitor) contract with multi-NEAR storage; owner decision, not built.
- [ ] A22 Guard payee check on mainnet: pure view, 0 NEAR: `get_charter(visitor)` allowlist plus the sealed-rule check off-chain; if the payee is not allowlisted show the refusal it would get (`receiver_not_allowlisted`/`hidden_rule_receiver`). Optional proof: one refused `propose` costs gas only.
- [ ] A23 Payout batches on mainnet: the board has no batch method and cannot be upgraded. Run payouts as up to 3 sequential `propose` calls (daily count 3, each <= cap 0.005, total <= budget 0.01) to allowlisted receivers (max 8, set via `set_rules`), shown as "one at a time, not all-or-nothing". Atomic batches stay testnet.
- [ ] A24 Toll gate on mainnet: visitor pays 0.001 via board `propose` to `toll.nearcarta.near`; backend checks that tx (as A19) and issues the gate pass (signed short-lived token) instead of the testnet gate contract. One tx, 0.001.
- [ ] A25 Mainnet chronicle feed: backend `/api/chronicle?net=mainnet&owner=` reads the visitor's `propose` txs to `board.nearcarta.near` (nearblocks API by account, or RPC on known hashes plus the `on_paid` outcome), cached, each row linking nearblocks.io. "Add today's entry" = one `propose` of 0.001. No new contract.

## N-series: mainnet-only, new palette, judge-ready (Nov 5, single checklist for the Cursor agent)
How to work: one small commit per item to `main`, simple undated message, never force push. Mark each item `[x] <commit>` or `[ ] BLOCKED: <reason>`. Acceptance tests are what you must run and paste the result of. Appendix with every grep hit: `docs/TESTNET_REMNANTS.md`.
Rule for every item: zero testnet anywhere a visitor or judge can see it; every label is truthful; no tx above 0.005 NEAR; no new contracts.

### T. Testnet remnants (remove or switch to mainnet)
- [ ] T1 **Town Chronicle lies (owner screenshot).** `app/design/D9_world/js/main.js:80-121` plays a scripted `r2own` story and calls `chron('P5','refused · r2own not on the oath')`; data from `js/core.js:85-94` (`r2oath.testnet`, `r2rcv.testnet`, `r2own.testnet`, `txUrl` = testnet.nearblocks.io); `js/fb.js:43,45` and `js/shops.js:18` label it `mainnet`; `index.html:40-41` says "Chronicle testnet". Fix: feed the strip from `/api/chronicle?net=mainnet` (PR #4 `board-chronicle.js`) plus the mainnet records in `shared/deployments/mainnet.json`; rewrite the scripted stranger to a mainnet payee (`shop-moved-pay-here.near` refused `receiver_not_allowlisted` tx `E7KMexjS…`); links `https://nearblocks.io/txns/`. Accept: Playwright on prod town, every `#chron a[href]` starts with `https://nearblocks.io/`, text has no `r2own|testnet`.
- [ ] T2 `app/design/D8_shops/js/main.js:86` maps `src: 'testnet'` to the label `mainnet`. A false label. Fix: drop the mapping; rows must carry real `src`. Accept: unit test that no row with a testnet tx renders a mainnet badge.
- [ ] T3 Explorer helpers hard-coded to testnet: `backend/src/near.js:161-162`, `app/design/D8_shops/js/core.js:115,117`, `app/design/D8_shops/js/apps.js:13`, `app/design/D6_dashboards/src/data.js:8-9`, `app/src/loop.html:31`, `app/shops/hall/main.js:20`, `backend/src/ferry.js:195`. Fix: one `explorer(net)` helper defaulting to mainnet. Accept: `rg 'testnet.nearblocks' app backend/src` = 0.
- [ ] T4 Static proof data that is testnet: `app/design/D6_dashboards/src/data.js` (all 35 hits: r2oath, r2own, r10oath, r7 DAO, v1.signer-prod.testnet, Base Sepolia), `app/design/D8_shops/data/live.js`, `app/src/live/data.js:53-56`, `app/src/live/shops-live.js:2,35`, `app/design/D8_shops/shops/chronicle.js:1,49`, `shops/hall.js:1,12,33`, `shops/toll.js:1,13`, `shops/tollrecords.js:8`, `shops/guard.js:14`, `shops/arenalive.js:30-55`, `shops/payouts.js:7-22`, `shops/bank.js:24-39`, `shops/_ui.js:1-16`. Fix: replace with the mainnet records (board, toll, arena, house, townhall, ferry intents) or delete the row. Accept: `rg -i testnet app/design/D8_shops app/design/D6_dashboards app/src` = 0 outside T30.
- [ ] T5 Remove guest accounts: `app/shops/vault/wallet.js:54` (`ncguest-*.testnet`), `app/house/onboard.js:1-49` (faucet, `ncdrip`), `backend/src/guest.js`, `app/house/setup.js:199,244,275,285,389,394,581`, `app/design/D8_shops/js/onboard.js:11`, `app/build.mjs:68`, `app/shops/vault/main.js:537`, `app/shops/INTEGRATION.md:9-10`. Delete the trial path and its env (`GUEST_SPONSOR_*`). Accept: `/setup` at 1440 and 390 shows no trial/guest/faucet; e2e passes.
- [ ] T6 Remove the arena testnet runner: `backend/scripts/arena-pool.js`, `arena3-reseed.js`, `backend/src/vault.js:35,285,678,709,737` (testnet archival RPC, leaderboard `network:'testnet'`), `ARENA_AGENT_KEY` use, `/api/health` `vault_runner`. Arena shows mainnet arena txs only (AZWxqZns / 25LpJRFF). Accept: `/api/health` and `/api/vault/*` contain no `testnet`.
- [ ] T7 Remove the Mist Bank testnet queue/worker: `backend/src/mistqueue.js` (utest1, `.testnet` charter regex, cipherscan testnet), `backend/scripts/mist-worker.js`, `mistbank-record.js`, routes in `backend/src/app.js`, `MIST_WORKER_TOKEN`. Keep only the mainnet NEAR leg (A19) and the NEAR AI TEE check. If the Zcash leg cannot be mainnet, remove the Zcash claim from the shop and README. Accept: Mist Bank shop text has no `testnet|utest`; A19 test still passes with Zcash leg removed or marked optional.
- [ ] T8 Remove the toll testnet settler and Base Sepolia gate: `backend/src/tollgate.js` (21 hits), `backend/scripts/toll-gate-deploy.js`, `toll-visitor.js`, `app/design/D8_shops/js/tollsplit.js:2-12` (`r7thmvr8maey.sputnikv2.testnet`, `lamp.ncpub-17102.testnet`, memo `toll:base-sepolia`), `apps.js:44,259-277`, `TOLL_SETTLER_*`. Toll = A24 mainnet pass only (+ mainnet chain-signature proof 4LKGpA5v / B9FFjcSA). Accept: toll shop + `/api/toll*` have no `sepolia|testnet`.
- [ ] T9 Town Hall testnet DAO page: `app/shops/hall/main.js:1-146` (`r7thmvr8maey.sputnikv2.testnet`, 0.1 bond). Until A21 is decided: hide the testnet vote page from navigation; Hall = A20 own-row changes + mainnet townhall txs (6UxwRmoE / Cp2rWatn). Accept: no link to the testnet vote from any page.
- [ ] T10 Payouts: `backend/src/payroll.js:1-14` (Circle testnet USDC), `shops/payouts.js`. Use A23 mainnet sequential payouts only; remove USDC testnet payroll or replace with one mainnet USDC payment (≤ 0.20 USD, owner OK first). Accept: `/api/payouts/*` no `testnet`.
- [ ] T11 Ferry: `backend/src/ferry.js:151-155` tidepool sandbox testnet, `core.js:41` "testnet stand-in", `apps.js:324` "testnet settlement". Ferry = the real mainnet 1Click swap (A6pqkcd3…, recorded). Accept: ferry shop text has no `testnet|stand-in`.
- [ ] T12 Prompt-injection payee `apps.js:390-392` `attacker.r10own-19371.testnet`, `arenalive.js:33` `attacker-drain.testnet`, `apps.js:511` regex accepts `.testnet`. Mainnet only. Accept: unit test that a `.testnet` receiver is rejected.
- [ ] T13 Copy/comments that a judge reads: `D9_world/world.css:35`, `js/life.js:44-52`, `js/core.js:37`, `game.js:359-362` (claims, check each), `house.js:66`, `hall/main.js:117,146`, `shops/guard.js:14`. Accept: visible text has 0 `testnet`.
- [ ] T14 `backend/src/config.js` (8 hits), `near.js:5`, `shops.js`, `ledger.js`, `ferry-guard.js`, `persist.js`, `tee.js`: default network mainnet, no testnet RPC fallback. Accept: `NEAR_NET` unset → mainnet; `/api/health` no `trial` block.
- [ ] T15 README.md (72 testnet hits), AGENTS.md (12), `judges/VERIFY.md` (40), `judges/TESTNET_TXS.md` (90): move every testnet claim into one clearly titled "Earlier testnet rehearsal (history)" section or delete; the judge path, track table and "do X see Y" must be mainnet only. Accept: README top 60% has 0 `testnet`.
- [ ] T16 Tests: delete/adjust unit and e2e tests for removed features (`guest.test.js`, `mistqueue.test.js`, `vault.test.js` testnet parts, `e2e/guard-live.spec.js`, `e2e/shops.spec.js`); add `test/unit/no-testnet-visible.test.js` that builds the app and greps the dist for `testnet|r2own|ncguest|sepolia|utest1`. Accept: `npm test` 0 fail; new test passes.
- [ ] T17 Render env: after T5-T8 delete code paths for `ARENA_AGENT_KEY`, `GUEST_SPONSOR_*`, `MIST_WORKER_TOKEN`, `TOLL_SETTLER_*`; set `TOLL_PASS_SECRET` (owner via hidden field, single-key `PUT /env-vars/{KEY}` only, never the bulk PUT). Check `WARM_EVERY_MS` (`backend/src/app.js:115`, default 60000): confirm it is unset or ≥ 60000 on Render and that warm reads hit mainnet RPC only. Accept: `/api/health` 200, boot log has no missing-secret warning.
- [ ] T30 If any testnet history stays, it lives only on `/judges` under the heading "Testnet rehearsal (history, not the product)" with testnet badges. Accept: no other page links testnet.

### C. Colour system (replace brown site-wide)
Current: brown/sand palette repeated by hand (`#17130f` 18×, `#1f1a15` 24×, `#f3ead8` 42×, `#d6b46a` 26×, `#2a241d`, `#3a3128`, `#9c8f79`, `#8a6a3e`, `#6b5a3a`) across `app/design/D7_system/tokens/tokens.css`, `D9_world/world.css`, `D9_world/game.css`, `D9_world/d7/d7.css`, `D8_shops/styles.css`, `D8_shops/js/polish.css`, `D6_dashboards/src/styles.css`, `app/src/setup/setup.css`, `app/src/sign/brand.css`, `app/src/console.css`, inline styles in `app/src/ledger.html`, `loop.html`.
- [ ] C1 Define tokens in `D7_system/tokens/tokens.css` (one source, imported everywhere). Proposed "night harbour" palette fitting the low-poly city: `--bg #0b1020`, `--surface #121a2e`, `--surface-2 #1a2440`, `--line #2c3a5e`, `--text #eef2ff`, `--text-2 #c3cbe6` (≥ 9:1 on bg), `--muted #9aa6c8` (≥ 7:1 on bg, ≥ 4.5:1 on surface-2), `--brand #00ec97` (NEAR green), `--accent #7aa7ff`, `--warn #ffc857`, `--danger #ff7a85`, `--ok #3ddc97`, `--focus #ffd166`; buttons: primary green bg with `#04140d` text. Verify every pair with a script. Accept: `scripts/contrast-check.mjs` prints every token pair ≥ 4.5:1 (body) / 3:1 (large, UI borders).
- [ ] C2 Replace every hard-coded hex in the files above with tokens. Accept: `rg -c '#(17130f|1f1a15|f3ead8|d6b46a|2a241d|3a3128|9c8f79|8a6a3e|6b5a3a|8a6d3b)' app` = 0 (excluding vendor).
- [ ] C3 Faded/low contrast to fix: `D8_shops/js/polish.css:11` `#8a6d3b`, `:16` `#6b5a3a`, `:24` `#6b7180` (onboard); `D9_world/world.css:53` `#8a6a3e` 10px; `game.css:43` 10px mono `--mute`; `setup.css:58` placeholder `#9c8f7999`; `#9c8f79` on `#3a3128` = 4.0:1 (fails); disabled states at `opacity .35-.55` (`styles.css:157,183,190,221,224`, `world.css:321-378`, `setup.css:47,141`) — use a disabled token with ≥ 3:1 and a text reason. Minimum text size 12px. Accept: axe-core run on `/`, `/setup`, `/sign`, every `/shops/*`, `/console`, `/ledger`, `/loop`, `/judges` = 0 colour-contrast violations at 1440 and 390.
- [ ] C4 Forms, menus, shop lists: setup steps, rules editor `#r-body`, shop tray, proof drawer, pin labels, account chip, dropdowns: one input style (surface-2, line border, focus ring `--focus` 2px), one menu style, list rows with clear hover/selected. Accept: screenshots of each at 1440/390 in `/opt/cursor/artifacts/screenshots/palette-*`.
- [ ] C5 Three.js tints in `D9_world/js/world.js:136`, `chars.js:234` and fog/sky colours match the new palette (cool night, warm window lights). Accept: town screenshot reviewed against C1.

### O. Open items carried over
- [ ] O11 Merge PR #4 (`cursor/mainnet-board-paths-752d`, head `1b34c60`; 380 tests, 379 pass) after T17 secret is set; deploy Vercel prod and Render image `ghcr.io/nearcarta/nearcarta-api:<sha>`. Accept: `/api/health` sha = main HEAD.
- [ ] O12 PR4 follow-ups: Mist empty Zcash txid gives 400 (`#zec-tx`) → becomes moot after T7, else "NEAR leg verified"; Hall button "Apply to my row" not "Propose"; Guard sealed-rule check labelled "preview"; chronicle rows `shop` derived from payee, not always `chronicle`.
- [ ] O13 A21 mainnet DAO: BLOCKED on owner decision (several NEAR; nearcarta.near ≈ 0.44). Do not build.
- [ ] O14 `secrets` CI job false positives (tx hashes, proof tokens): add a `.gitleaks.toml` allowlist regex for base58 tx hashes of length 43-44 in `README.md`, `docs/*.md`, `shared/deployments/*.json`, `judges/**`, instead of per-fingerprint entries. Accept: `secrets` job green on main.
- [ ] O15 Return-to-city button on every page incl. `/sign`, `/ferry-widget`, `/loop`, `/ledger`, `/judges`, every shop interior and the 404, same label and position. Accept: e2e loops all routes and finds `[data-testid=back-town]` visible.
- [ ] O16 Shop names clear and the same everywhere (`plain.js:7` NAME, `fb.js:6`, `town.js`, `core.js`, README): each name + a one-line plain purpose. Accept: unit test that all name maps are equal.
- [ ] O17 Live mainnet browser test of every shop with a real wallet, tiny txs (≤ 0.005 each, ≤ 0.01/day per row); record each tx hash in README + `shared/deployments/mainnet.json`; `npm run verify:mainnet` all pass.
- [ ] O18 Cinematic onboarding (O1) on the new palette.
- [ ] O19 Deep tests: Playwright mainnet read-only suite against prod for every route; property tests for board-plan caps; a test that every README tx hash resolves on mainnet RPC.
- [ ] O20 Push tag `hackathon-submission` only when the owner says so (README compare link).

### R. README that proves every claim (AI judges read it first)
- [ ] R1 Top: one-sentence pitch, live link, 60-second "do X, see Y" on mainnet, then the mainnet tx table (allowed + refused per shop) with nearblocks.io links.
- [ ] R2 "Claim → proof" table: each claim links code file:line, the test name, and a mainnet tx. Any claim without all three is removed.
- [ ] R3 "Technologies used" (blog rule): NEAR AI Cloud TEE, Intents/1Click, Chain Signatures, NEP-171, NEP-297 events, Privy social login, board contract; each with where it runs.
- [ ] R4 Track section: one row per entered track (security, business, privacy, agents, games, nfts, social, open) mapping track words to shop + proof; skip defi/thesis/memecoins, swarms/realworld only with proof.
- [ ] R5 Honest limits section (board is immutable, A21 not built, what the API signs). One test count from `npm test`.
- [ ] R6 `scripts/check-cited.mjs` passes: every hash, path and test name in README exists.

### J. Judging criteria and track requirements → tasks
Source: `nearhackathon.com/HACKATHON.md` (RULES_AUDIT R11-R12), `WIN_MATRIX.md`, owner track guides `near-tracks/*.md`. Criteria: technical implementation, design, impact, originality, sustainability; AI judges (Claude Code, Codex) screen the repo first.
- [ ] J8 Technical: clean `npm test`, `cargo test`, CI green (O14), mainnet verify script (R6/O17).
- [ ] J9 Design: palette C1-C5, axe clean, 1440/390 screenshots in README.
- [ ] J10 Impact/realworld ("a normal company could use tomorrow"): Payouts + Toll as a business spend-limit story in README; one mainnet USDC payment only with owner OK (T10).
- [ ] J11 Security track ("spending limits, policy engines… without giving it the keys"): README leads with refused mainnet txs (`over_per_action_cap` CcPMX1Dt…, `receiver_not_allowlisted` E7KMexjS…), agent key = function-call only, board has 0 access keys.
- [ ] J12 Privacy track: NEAR AI TEE attestation proof file linked; drop testnet Zcash claims (T7).
- [ ] J13 Agents/business ("Intents, Chain Signatures", "universal checkout"): Ferry mainnet 1Click swap + charter gate (F1) front and centre.
- [ ] J14 Games ("judged on the game loop… players never notice the chain"): README section on the town loop; no chain jargon in town copy.
- [ ] J15 NFTs ("ownership with behavior"): house deed mainnet tx 83nyJmTW with test showing deed → control.
- [ ] J16 Social ("on top of Sputnik DAO and Trezu, don't rebuild the multisig"): only claim what mainnet Hall does (A20); A21 blocked.
- [ ] J17 Submission rules: public repo, X post with demo (owner posts), one submission, no edits; the agent does not submit or post.
