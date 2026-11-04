# Nearcarta master task list (single source of truth; tick each with commit + test + screenshot)

## Owner items (original 9)
- [ ] O1 Premium cinematic onboarding. Blocker: there is no public charter factory on mainnet (`docs/MAINNET_COST_PLAN.md`, `shared/deployments/mainnet.json` has charter/toll/arena/house/townhall and no factory). The default path (`46d66db`, `20ca3ae`, test `the default setup path is mainnet`) signs in on mainnet, shows the town's mainnet allow/refuse txs, and does not pretend to create a personal charter. The secondary testnet trial still runs sign, agent key, and try. Stepper steps at or before the current step are clickable (`20ca3ae`). Screenshots of every step are still outstanding. A mainnet factory is not deployed from here.
- [x] O2 Sign in is the only primary CTA. `5a01d11`, `1a72d4e`. Test: e2e `town pin opens setup` expects zero "Connect wallet".
- [x] O3 Character creator: six looks, dyes, outfits, name, live portrait, saved in `nearcarta.hero.v1`, shown by `app/design/D9_world/js/hero-town.js`. `5a01d11`.
- [x] O4 Leaderboard lists factory charters and hides `shared/vault/denied-accounts.json`. `20ca3ae`. Test: `a factory charter appears unless we created that account`.
- [x] O5 Back to town is on setup, vault, hall, console, judges, ledger, loop, 404, and the shop interiors. The town page is the town.
- [x] O6 Default journey is mainnet. Guest trial is a secondary control and is the only path that says testnet. `46d66db`, `20ca3ae`. Test: `the default setup path is mainnet and does not offer the faucet or a charter factory`.
- [x] O7 Proof drawer sits above the top-right account row (`app/build.mjs` hides `#acct` while the drawer is open). Town labels and the "Click a building" hint: `20ca3ae`.
- [x] O8 Logo is `app/src/brand/mark.svg`, favicon `/favicon.svg`, og image `/brand/og.png`.
- [x] O9 Agent binding and extra model fields cannot change the payment. `110019b`, `1a72d4e`. Tests: `a model that invents a payee is discarded for the words`, `extra model fields cannot change the payment method`. npm audit highs are zod inside Privy (no zod 3 fix) and are not force-upgraded.
- [x] O10 `render.yaml` plan is `starter`. `1a72d4e`.

## Judge signals (done in cce69a8, keep)
- [x] J1 README mainnet do-X-see-Y first
- [x] J2 /api/receipts uniform
- [x] J3 inference cap
- [x] J4 why-contract section
- [x] J5 demo up to Nov 25
- [x] J6 PR #1 fast-forwarded onto main (`1a72d4e`). Later commits stay on main. Leaderboard is O4 (`20ca3ae`).
- [x] J7 `/api/health` returns `network.contracts: mainnet` and `network.trial: testnet`. `d363c91`. Test: `health names mainnet contracts and the testnet trial`.

## Prod audit (my screenshots)
- [x] A1 Landing story is "The town runs on NEAR mainnet." Shop badges say mainnet. `20ca3ae`.
- [x] A2 `/console` is a judges page. Mainnet receipts first. No account chip and no testnet-block PASS. `20ca3ae`.
- [x] A3 Larger pin labels, overlap nudge, "Click a building" hint. `20ca3ae`.
- [x] A4 Judges menu is "For judges". The account chip is the character name plus a short id. `20ca3ae`.
- [x] A5 A shop without a charter still shows what it does and the mainnet proof. `20ca3ae`.
- [x] A6 One button, Sign in, until the shop can run. `20ca3ae`.
- [x] A7 The shop button is no longer left on "Opening…". `20ca3ae`.
- [x] A8 Town Hall strips markup and lists every proposal. `20ca3ae`.
- [x] A9 Amount icons attach only to a number plus a symbol, so "kept on NEAR" and "1 USDC" no longer gain a broken gap. `20ca3ae`.
- [x] A10 Mist and Ferry lead with plain words. Technical rows sit under Technical details. `20ca3ae`.
- [x] A11 `/loop` shows the five steps before you press the button. `20ca3ae`. Test: `loop page: timer, the two real calls, a plain plan, routes`.
- [x] A12 Ledger shop names match the town. Refusals are 0 NEAR, not a fake payment. The model line says it is operator spend. `20ca3ae`.
- [x] A13 Setup fund on the mainnet path can continue at 0 NEAR. The address shown is short. Earlier steps are clickable. `20ca3ae`.
- [x] A14 "Open the charter office" stays `/shops/vault/`. `hero-town.js` no longer rewrites it to `/setup`.

## Ferry universal checkout (after above)
- [x] F1 Pay (`/ferry-widget`, `app/src/ferry-pay.js`) lets the payer pick a chain. `POST /api/ferry/checkout` reads the charter first (`backend/src/ferry-checkout.js` `charterGate`: allowlist, cap, daily budget, daily count, window, frozen, sealed rule). Only then does it ask 1Click for a deposit address, and only if the signed amount is at most 0.20 USD. The receipt is rail `intents`; `tx` is the deposit address, then the chain tx once status is SUCCESS. `quote()` stays dry. `2333267`. Tests: `a refused recipient never asks 1Click, and an allowed one returns a deposit address`, `an amount over 0.20 USD never asks for a deposit address`, e2e `ferry checkout: mocked 1Click returns a deposit address only after the charter allows it`. The owner runs `node backend/scripts/ferry-live-swap.js --live --amount 0.2 --from USDC@base --to USDC@near --refund-to 0xYOURADDRESS`. That script was not run here, and it does not send the deposit.
- [x] F2 Ferry’s proof now shows the mainnet charter allow and the over-cap refusal, and the shop links to Pay. The Guardhouse proof points at Mist Bank’s “Verify the TEE now” check. Toll, arena, house and town hall already show their mainnet allow and refuse txs. Mist Bank stays a testnet shielded payout plus that TEE check. No further shop gap can be closed without a new mainnet transaction or a contract deploy. `2333267`.

## Done when
Playwright shots of every onboarding step and every shop at 1440 and 390 are not in this commit. Pay at 1440 and 390 was captured for this checkout. The unit suite is `npm test` (358 pass, 1 skipped). CI runs that suite on push to main.
