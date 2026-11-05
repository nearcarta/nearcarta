# AGENTS.md

Notes for coding agents (and people) working in this repo. Read docs/AGENT_CONTEXT.md for the project map, then README.md; judges/VERIFY.md has the full check list.

## Judge guide (for AI agents checking this repo)
1. Read the "For AI judges" table in README.md: each claim names its code line, its test and a tx.
2. Run `npm ci && npm test` (offline, 376 pass, 1 skipped) and `cd contracts/oath && cargo test --lib` (122 pass). `cd contracts/charter_board && cargo +1.86.0 test --lib` is 15 pass.
3. Visitor path: Start here opens `/setup` (`app/design/D9_world/index.html` `#rulesBtn`; e2e `town pin opens setup and each step renders`). The default path is a mainnet account and real NEAR (`shared/setup/path.js` `setupJourney`). After a charter exists, that pin opens the charter office (`app/design/D9_world/js/main.js` `paintStart`).
4. Public leaderboard: `backend/src/vault.js` `publicPlayers` and `shared/vault/denied-accounts.json`. Test: `a factory charter appears unless we created that account`.
5. The model keeps the payee and the amount the visitor named: `backend/src/agent.js` `propose`. Tests: `a model that invents a payee is discarded for the words`, `a model that raises the amount is kept to the amount in the message`.
6. Run the oath sandbox suites (sandbox, exploits, adversarial, teardown, props) with the three commands in README.md; they need no keys or network beyond the near-sandbox download.
7. Run `npm run verify` to re-read the mainnet proof txs (same check as `npm run verify:mainnet`, 54/54, written to `judges/proofs/mainnet-proof-check.json`), and `npm run check-cited` to check every cited file, account and hash.
8. Addresses live only in `shared/deployments/mainnet.json`.
9. The spend gate is the charter (`contracts/oath` `propose`). The agent key can only call `propose` and `propose_batch`. `GET /api/receipts` returns one shape for the NEAR transfer, the chain-signature toll, the Intents quote and the NEAR AI job (`shared/rails/receipts.js`). The dry intents row has no tx. A checkout row carries the deposit address after `openCheckout` (`backend/src/ferry-checkout.js`). Test: `every rail uses the same receipt keys`.
10. A model job is capped before it is sent: 160 tokens, $0.05 and 300 calls a day (`backend/src/agent.js` `budgetStatus`, `GET /api/agent/budget`). The NEAR that job can move is still the charter's cap. Test: `an intents receipt has no tx, and a model job names its dollar cap`. A Pay checkout is capped at 0.20 USD before a deposit address is created. Test: `an amount over 0.20 USD never asks for a deposit address`.
Skipped e2e tests would sign real transactions and need a funded key or an opt-in flag; they are skipped, not mocked.

## Layout
- `contracts/oath`: the charter (Rust, near-sdk). It is the only door to the agent's account. Deployed on mainnet as `charter.nearcarta.near`.
- `contracts/arena`, `contracts/toll`, `contracts/townhall`, `contracts/mock_ft`: one contract per shop. Toll runs its own smaller contract. Town Hall writes `set_rules` on the visitor's own row (see README, Tracks).
- `backend/src`: the API (`server.js`, one module per shop). `backend/scripts`: proof recorders and checkers; apart from the arena runner's `propose` (`backend/src/vault.js`), only these sign txs.
- `app/src`: the console UI. `app/design`: the 3D town and shop interiors. They get live data only through `app/src/live/data.js` (and `app/design/D6_dashboards/src/data.js`); keep data wiring in those interfaces.
- `shared/deployments/mainnet.json`: every mainnet account, contract and proof tx. Code and docs read ids from here; do not hardcode them.
- `judges/`: VERIFY.md and `proofs/*.json` (generated).
- `vercel.json` and `middleware.js`: Vercel serves the pages and passes `/api/*` to the Render API (`render.yaml`, `Dockerfile`).

## Commands
```bash
npm ci
npm test                      # unit tests (offline)
npm run test:integration      # live: NEAR mainnet reads, 1Click dry quotes, NEAR AI TEE check
npm run verify                # re-reads every proof tx from mainnet -> judges/proofs/mainnet-proof-check.json
npm run build && npm run e2e  # browser tests (backend on :8787, app on :5173)
npm run readme-numbers        # writes the counts in README.md and judges/VERIFY.md from the outputs above
npm run test:contracts        # (CI job oath-sandbox builds oath and reaper with rustc 1.86, then runs every oath sandbox suite)
                              # every contract; oath + charter_factory sandbox tests need pkg-config + OpenSSL headers (SKIP_SANDBOX=1 skips them)
```
Run `npm run readme-numbers -- --check` before a commit that touches tests or proofs; it fails if a number in the docs is stale.

## Rules
- The town contracts in `shared/deployments/mainnet.json` are already on mainnet. The API does not sign mainnet. `quote()` stays `dry:true`. `POST /api/ferry/checkout` may ask 1Click for a deposit address after the charter view allows the recipient, and only for at most 0.20 USD (`backend/src/ferry-checkout.js`). It does not sign and it does not send the deposit. Confidential Intents quotes stay dry. Never sign a mainnet tx. The visitor board (`contracts/charter_board`, `docs/MAINNET_BOARD.md`) is live. A replacement wasm is deployed by the owner with `backend/scripts/deploy-mainnet-board.js`; this API does not run that script. The live account has no access key, so new code needs a new account after `reap` (`docs/MAINNET_BOARD.md`). `npm run verify` and `npm run verify:mainnet` re-read the mainnet proof txs and do not sign.
- The deployed API holds no NEAR key. Vault ask, attack and task return 503. Keys live outside the repo (`.secrets/` is ignored). Never commit, log or print a key or token.
- `AI_PROVE_ENABLED` stays off unless the account has credits; the TEE evidence check is free and always on.
- Every claim in a doc links to a test or a mainnet tx. If you cannot point to one, do not write the claim.
- Contract view args: U64 values are strings (`"4"`, not `4`). `get_action` takes `action_id`; its record has `clause_id`.
- The agent in the town is the Lamplighter. Agents get no human names.
- Run `gitleaks git --config .gitleaks.toml --redact .` before every push.
