# Nearcarta master task list (single source of truth; tick each with commit + test + screenshot)

## Owner items (original 9)
- [ ] O1 Premium cinematic onboarding. The lock factory is retired: one oath wasm per visitor does not fit `nearcarta.near`, and a global contract's storage burn does not come back (`docs/MAINNET_FACTORY.md`). The visitor path is one board, `contracts/charter_board`: a row per account (allowlist, caps, window, freeze, sealed rule, ed25519 agent key), at most 0.02 NEAR, refunded by `close_charter`. `reap` deletes the account only when no row is open (`docs/MAINNET_BOARD.md`). `backend/scripts/deploy-mainnet-board.js` prints the exact yoctoNEAR cost and does not sign unless the owner passes `--live` with `NEAR_MAINNET_SIGNER_KEY`. It refuses a plan over 1 NEAR. Blocked: that script has not been run, so `board.status` in `shared/deployments/mainnet.json` stays `not_deployed` and `/setup` does not send `open_charter`. With `NEXT_PUBLIC_MAINNET=1` and status `deployed`, the same page opens the row (test `the public mainnet flag hides the guest and opens a charter row only after the board is deployed`). `460c8ef`. Contract tests: `cargo +1.95.0 test --lib` in `contracts/charter_board` (11 pass, including `an_allowed_payment_moves_only_that_visitors_balance`, `refusals_leave_both_rows_untouched`, `close_refunds_the_row_stake_and_the_unspent_balance`). Cost test: `the board wasm deploys for at most 1 NEAR and the state size matches the contract`. Dry run of the script on this wasm: total `796631993114499300000000` yoctoNEAR (0.79663 NEAR), peak `806119931144993000000000` yoctoNEAR (0.80612 NEAR).
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

## Done when
Playwright shots of every setup step and every shop at 1440 and 390 are in `/opt/cursor/artifacts/screenshots/` (`setup-signin` through `setup-try`, `shop-house`, `shop-toll`, `shop-ferry`, `shop-bank`, `shop-guard`, `shop-arena`, `shop-hall`, `shop-payouts`, plus `ferry-widget`, `console`, and `town`). They are not committed. The unit suite is `npm test`. `cargo +1.95.0 test --lib` in `contracts/charter_board` covers the row. CI runs the backend suite and that crate on push to main. O1 stays open until the owner runs `backend/scripts/deploy-mainnet-board.js --live`.
