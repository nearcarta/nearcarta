# AGENTS.md

Notes for coding agents (and people) working in this repo. Read README.md first; judges/VERIFY.md has the full check list.

## Layout
- `contracts/oath`: the charter (Rust, near-sdk). It is the only door to the agent's account. Deployed on testnet as `r11oath-82930.testnet` (R11 code).
- `contracts/arena`, `contracts/toll`, `contracts/townhall`, `contracts/mock_ft`: one contract per shop. Toll runs its own smaller contract; Town Hall runs the charter (R14, R16.1) owned by a Sputnik DAO (see README, Limits).
- `backend/src`: the API (`server.js`, one module per shop). `backend/scripts`: proof recorders and checkers; apart from the arena runner's `propose` (`backend/src/vault.js`), only these sign txs.
- `app/src`: the console UI. `app/design`: the 3D town and shop interiors. They get live data only through `app/src/live/data.js` (and `app/design/D6_dashboards/src/data.js`); keep data wiring in those interfaces.
- `shared/deployments/testnet.json`: every testnet account, contract and proof tx. Code and docs read ids from here; do not hardcode them.
- `judges/`: VERIFY.md, TESTNET_TXS.md (generated) and `proofs/*.json` (generated).
- `vercel.json` and `middleware.js`: Vercel serves the pages and passes `/api/*` to the Render API (`render.yaml`, `Dockerfile`).

## Commands
```bash
npm ci
npm test                      # unit tests (offline)
npm run test:integration      # live: NEAR testnet, 1Click dry quotes, NEAR AI TEE check
npm run verify                # re-reads every proof tx from testnet -> judges/proofs/proof-check.json
npm run txs                   # rewrites judges/TESTNET_TXS.md from the verify output
npm run build && npm run e2e  # browser tests (backend on :8787, app on :5173)
npm run readme-numbers        # writes the counts in README.md and judges/VERIFY.md from the outputs above
npm run test:contracts        # every contract; oath + charter_factory sandbox tests need pkg-config + OpenSSL headers (SKIP_SANDBOX=1 skips them)
```
Run `npm run readme-numbers -- --check` before a commit that touches tests or proofs; it fails if a number in the docs is stale.

## Rules
- Testnet only. Ferry and the Confidential Intents legs use 1Click mainnet as `dry:true` quotes: no deposit address, no spend. Never sign a mainnet tx.
- The deployed API holds one NEAR key: the arena runner's function-call key (`ARENA_AGENT_KEY`), which can only call `propose` on `arena.nccharters-53681.testnet`. It holds no owner, full-access or Zcash key, and signs nothing else. Keys live outside the repo (`.secrets/` is ignored). Never commit, log or print a key or token.
- `AI_PROVE_ENABLED` stays off unless the account has credits; the TEE evidence check is free and always on.
- Every claim in a doc links to a test or a testnet tx. If you cannot point to one, do not write the claim.
- Contract view args: U64 values are strings (`"4"`, not `4`). `get_action` takes `action_id`; its record has `clause_id`.
- The agent in the town is the Lamplighter. Agents get no human names.
- Run `gitleaks git --config .gitleaks.toml --redact .` before every push.
