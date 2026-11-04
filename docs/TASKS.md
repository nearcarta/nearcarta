# Nearcarta master task list (single source of truth; tick each with commit + test + screenshot)
## Owner items (original 9)
- [ ] O1 Premium cinematic onboarding; START HERE pin and every Start button open /setup flow: sign in > fund > privacy > character > rules > sign charter+agent key > try allowed/refused. Charter office reachable after setup. Completed stepper steps clickable.
- [ ] O2 'Connect wallet' -> 'Sign in' everywhere; one primary CTA (no Start free vs Connect confusion).
- [ ] O3 Amazing character creator: several distinct looks, colors/outfit, name, live preview, saved, shown in town.
- [ ] O4 Real leaderboard: real visitors appear automatically; denylist our scripted/test accounts; nickname+character, score, tx link; good empty state; no fake rows.
- [ ] O5 'Back to town' on every page.
- [ ] O6 No testnet in the user journey; mainnet default; any guest trial secondary and honestly labeled; never fake mainnet.
- [ ] O7 Full design audit 1440/390; fix top-right buttons overlapping proof drawer title.
- [ ] O8 Original SVG town logo: header, favicon, og image.
- [ ] O9 Red-team pass (prompt injection, policy bypass on agent+API, deps, secrets) with fixes and tests.
- [ ] O10 render.yaml plan: starter.
## Judge signals (done in cce69a8, keep)
- [x] J1 README mainnet do-X-see-Y first  - [x] J2 /api/receipts uniform  - [x] J3 inference cap  - [x] J4 why-contract section  - [x] J5 demo up to Nov 25
- [ ] J6 Merge PR #1 to main; commit to main only. Leaderboard per O4.
- [ ] J7 /api/health network shape kept.
## Prod audit (my screenshots)
- [ ] A1 Landing testnet/mainnet contradictions  - [ ] A2 /console: redesign as premium For-judges page or fold+redirect
- [ ] A3 Town labels tiny/overlapping; 'click a building' hint  - [ ] A4 Top bar: judges menu wrap; account chip nickname + short id
- [ ] A5 Shops without charter: preview/demo + live proof before asking  - [ ] A6 One state, one CTA (no skeleton + Sign in + Build charter)
- [ ] A7 'Opening...' stuck button  - [ ] A8 Town Hall raw markup; show all proposals
- [ ] A9 Spacing bugs (USDC, Base, House missing glyph)  - [ ] A10 Mist/Ferry jargon -> plain words, details toggle
- [ ] A11 /loop empty page  - [ ] A12 /ledger wrapping, shop names match town, mock-looking rows
- [ ] A13 /setup Fund dead end, contrast, copy, full address  - [ ] A14 House 'Open the charter office' goes to /setup
## Ferry universal checkout (after above)
- [ ] F1 Pay from any wallet/chain via NEAR Intents 1Click, charter gates on chain, embeddable widget, receipts, tests, README, script for one real tiny mainnet swap (I run it).
- [ ] F2 Review every shop for judge-loved gaps.
## Done when: every box ticked in docs/TASKS.md in repo, CI green, Playwright shots of every step/shop 1440+390 as artifacts, final report per ID.
