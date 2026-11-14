# Architecture

A map of this repo: pages, API routes, contracts and commands. Claims about live money point at `shared/deployments/mainnet.json`, `judges/VERIFY.md`, or a test named below. Account ids live only in that deployments file.

The town agent is the Lamplighter.

## Guarantees

- The API does not sign mainnet. `quote()` stays `dry: true`. `POST /api/ferry/checkout` may ask 1Click for a deposit address only after the visitor row allows the recipient and the amount (`backend/src/ferry-checkout.js`). There is no product USD cap; the row is the only limit. It does not send the deposit.
- The deployed API holds no NEAR key. Vault ask, attack, and task return 503 without one. Keys stay outside the repo; CI runs gitleaks over the full history.
- Visitor and judge surfaces are mainnet. Addresses are read from `shared/deployments/mainnet.json`, not hardcoded.
- Contract view args: U64 values are strings. `get_action` takes `action_id`; its record has `clause_id`.
- The spend gate is the visitor's row on the board (`contracts/charter_board`). The row's agent key can call `propose`, `propose_call`, `propose_call_as`, `confirm_hold`, `tighten_rules` and `anchor`, and nothing else.
- A model job is capped before it is sent: 160 tokens, $0.05, and 300 calls a day (`backend/src/agent.js` `budgetStatus`). The NEAR it can move is still the charter cap.
- `AI_PROVE_ENABLED` stays off unless the account has credits. The TEE evidence check is free and always on.
- Every claim in a doc points at a test or a mainnet tx in the repo.

## Layout

| Path | What |
|---|---|
| `app/design/D9_world/` | The town page (`/`). `index.html`, `world.css`, `js/main.js` (3D), `js/fb.js` (2D, `?mode=2d`). |
| `app/design/D8_shops/` | Shop interiors opened from the town. Live data goes through `app/src/live/data.js`. |
| `app/src/panels/` | Shop pages under `/shops/<name>/`. `boot.js` mounts `deep.js`. |
| `app/src/setup/` | `/setup/` HTML and CSS. The script is `app/house/setup.js`, built to `/setup/setup.bundle.js`. |
| `app/shops/` | Charter office, Town Hall proposals, and Payouts sources. `build.mjs` writes `app/dist`. |
| `app/house/` | Wallet connector (`house.js`) and the setup stepper (`setup.js`). |
| `backend/src/server.js` | API process. Routes are in `backend/src/app.js` and `backend/src/vault.js`. |
| `contracts/` | One crate per contract. See the table below. |
| `shared/deployments/mainnet.json` | Every mainnet account, contract, and proof tx. |
| `shared/rails/receipts.js` | One receipt shape for a NEAR transfer, a chain-signature toll, an Intents quote, and a NEAR AI job. |
| `vercel.json`, `middleware.js` | Vercel serves `app/dist` and rewrites `/api/*` to the Render API. |
| `render.yaml`, `Dockerfile` | The API image. Health check is `/api/health`. |

`npm run build` (`app/build.mjs`) copies `app/src` and `app/design` into `app/dist`, bundles the wallet and setup, and writes `/` from `app/design/D9_world/index.html`.

## Shops

Frontend routes are the built pages. Backend routes are the public reads. Contract ids are the `contract` fields in `shared/deployments/mainnet.json`.

| Shop | Page | Frontend | Backend | Contract crate |
|---|---|---|---|---|
| Town | `/` | `app/design/D9_world/index.html`, `js/main.js`, `js/fb.js` | `GET /api/health`, `GET /api/mainnet` | — |
| Setup | `/setup/` | `app/src/setup/index.html`, `app/house/setup.js` | `GET /api/vault/config` | `contracts/charter_board` (`board`) |
| Charter office | `/shops/vault/` | `app/shops/vault/index.html`, `main.js`, `vault.css` | `backend/src/vault.js`: `GET /api/vault/config`, `GET /api/vault/leaderboard`, `GET /api/agent/budget` | `contracts/oath` (`charter`); row edits are the board |
| Town Hall | `/shops/hall/`, `/shops/townhall/` | `app/src/panels/hall.js`, `hall-ui.js`; proposals in `app/shops/hall/` | `GET /api/townhall`, `GET /api/board/row/:owner` | `contracts/townhall`; row is `contracts/charter_board` |
| Your House | `/shops/house/` | `app/src/panels/deep.js` `mountHouse`; wallet in `app/house/house.js` | `GET /api/house`, `GET /api/house/deed`, `GET /api/board/row/:owner` | `contracts/house_nft` (`extras.house`) |
| Ferry | `/shops/ferry/`, `/ferry-widget` | `app/src/panels/deep.js` `mountFerry`, `app/src/ferry-pay.js` | `backend/src/ferry.js`, `ferry-checkout.js`: `POST /api/ferry/quote`, `POST /api/ferry/checkout` | Intents quote stays dry. Proof txs are `ferry_intents` in the deployments file |
| Mist Bank | `/shops/bank/` (also `mist`, `mistbank`) | `mountBank` in `deep.js` | `backend/src/mistbank.js`: `GET /api/mistbank`, `POST /api/mistbank/verify` | Commitment only. No viewing key is served |
| Guardhouse | `/shops/guard/` | `mountGuard` in `deep.js` | `backend/src/guardhouse.js`: `GET /api/guardhouse` | Charter check. Recorded txs are under `charter.txs` |
| Vault Arena | `/shops/arena/` | `mountArena` in `deep.js`; room copy in `app/design/D8_shops/shops/arena.js` | `backend/src/arena.js`: `GET /api/arena` | `contracts/arena` (`extras.arena`) |
| Toll Bridge | `/shops/toll/` | `mountToll` in `deep.js` | `backend/src/tollgate.js`, `toll-pass.js`: `GET /api/toll`, `GET /api/toll/gate` | `contracts/toll` |
| Chronicle | `/shops/chronicle/` | `mountChronicle` in `deep.js` | `backend/src/board-chronicle.js`: `GET /api/chronicle` | Reads the deployments file. It does not sign |
| Payouts | `/shops/payouts/` | `app/shops/payouts/` | `GET /api/payouts/usdc` | No spend from this page |

Shop pages other than the charter office, Town Hall proposals, and Payouts are generated by `app/shops/build.mjs` and booted by `app/src/panels/boot.js`. The shared browser session is `app/design/D8_shops/js/session.js` (`nearcarta.setup.v1`).

## Deploy

```bash
NEARCARTA_API= npm run build          # app/dist. Empty NEARCARTA_API keeps /api on the same origin
node app/serve.mjs                     # UI on :5173, proxies /api to :8787
node backend/src/server.js             # API. Binds 0.0.0.0:$PORT (Dockerfile uses 10000)
node backend/scripts/deploy-mainnet-board.js
```

`deploy-mainnet-board.js` prints the yoctoNEAR cost and does not sign unless `--live` is passed with `NEAR_MAINNET_SIGNER_KEY`. See `docs/MAINNET_BOARD.md`. The API process does not run that script.

Vercel: `vercel.json` builds with `npm run build`, publishes `app/dist`, and rewrites `/api/*` to the Render service. Render runs the image from `Dockerfile` (`CMD node backend/src/server.js`). `render.yaml` is the blueprint. Health is `GET /api/health` (`network.contracts` is `mainnet`, `features.signing` is false when no key is loaded).

## Tests

```bash
npm ci
npm test                               # backend unit tests, offline
npm run test:integration               # live mainnet reads, dry 1Click quotes, TEE check
npm run verify                         # re-reads proof txs into judges/proofs/mainnet-proof-check.json
npm run check-cited                    # cited files, accounts, and hashes
npm run build && npm run e2e           # Playwright. Backend on :8787, app on :5173
npm run test:contracts                 # contract crates, including the oath sandbox suites
npm run readme-numbers -- --check      # README and judges/VERIFY.md counts match the last full run
```

Counts in `README.md` come from a full run. A partial Playwright run writes `judges/proofs/e2e-results.json`; only full runs are committed.

Oath library tests: `cd contracts/oath && cargo test --lib`. Board library tests: `cd contracts/charter_board && cargo +1.86.0 test --lib`. The sandbox suites run with `npm run test:contracts`.

Browser checks for the shop shell live in `e2e/section-s.spec.js` and the earlier `e2e/section-*.spec.js` files. Skipped end-to-end tests would sign real transactions. They are skipped, not mocked.
