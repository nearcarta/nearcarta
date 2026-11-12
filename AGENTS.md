# AGENTS.md

Notes for coding agents and people working in this repo. docs/AGENT_CONTEXT.md is the project map; judges/VERIFY.md lists the read-only checks.

## Layout
- `contracts/charter_board`: the visitor board, one row per visitor, live as `board.nearcarta.near`. `contracts/oath` is the original per-visitor charter it replaced (unit and sandbox tests kept).
- `contracts/market` (live as `arena.nearcarta.near`), `contracts/toll`, `contracts/hall` (`townhall.nearcarta.near`), `contracts/house_nft`, `contracts/guard`: one contract per shop. `contracts/deployed.json` maps each live account to its crate.
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
- The town contracts in `shared/deployments/mainnet.json` are already on mainnet. The API does not sign mainnet. `quote()` stays `dry:true`. `POST /api/ferry/checkout` may ask 1Click for a deposit address after the visitor row allows the recipient and the amount (`backend/src/ferry-checkout.js`). There is no product USD cap; the row is the only limit. It does not sign and it does not send the deposit. Confidential Intents quotes stay dry. Never sign a mainnet tx. The visitor board (`contracts/charter_board`, `docs/MAINNET_BOARD.md`) is live. A replacement wasm is deployed by the owner with `backend/scripts/deploy-mainnet-board.js`; this API does not run that script. The live account has no access key, so new code needs a new account after `reap` (`docs/MAINNET_BOARD.md`). `npm run verify` and `npm run verify:mainnet` re-read the mainnet proof txs and do not sign.
- The deployed API holds no NEAR key. Vault ask, attack and task return 503. Keys live outside the repo (`.secrets/` is ignored). Never commit, log or print a key or token.
- `AI_PROVE_ENABLED` stays off unless the account has credits; the TEE evidence check is free and always on.
- Every claim in a doc links to a test or a mainnet tx. If you cannot point to one, do not write the claim.
- Contract view args: U64 values are strings (`"4"`, not `4`). `get_action` takes `action_id`; its record has `clause_id`.
- The agent in the town is the Lamplighter. Agents get no human names.
- Run `gitleaks git --config .gitleaks.toml --redact .` before every push.
