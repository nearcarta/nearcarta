# Shop modules: Charter office and Vault Arena

Self-contained. Nothing in `app/design` or `app/src` is changed.

## What it is
`/shops/vault/` is one page with four parts:
1. **Connect** through NEAR Connect (`@hot-labs/near-connect`, testnet). There is also an optional
   guest wallet: a new account from the public testnet faucet. Its key is made in the browser and
   stays in that browser's localStorage. The backend never sees it.
2. **Create a charter.** The wallet signs `create_charter(name)` on the factory with a 0.3–5 NEAR
   deposit. The factory creates `<name>.<factory>`, points it at the global R14 oath code by hash,
   and sets the visitor as the owner.
3. **Rules and agent key.** One wallet approval sends `set_clause("pay", …)` and
   `set_agent_key(pk)`. The agent key is made in the browser and can only call `propose`.
4. **Attack.**
   - On the visitor's own charter, the browser signs `propose` with the agent key, then posts the
     refusal to `POST /api/vault/record`.
   - On the shared arena charter, `POST /api/vault/attack` runs the attack with no wallet.
   - The leaderboard (`GET /api/vault/leaderboard`) is rebuilt from chain.

## Hook it into the city
- **Build.** `app/build.mjs` calls `buildShops(dist, esbuild)` from `app/shops/build.mjs`. The
  output goes to `app/dist/shops/vault/{index.html, vault.css, vault.bundle.js}`. The page reads
  `../../config.js` (`NEARCARTA_API`) and `../../design/D7_system/tokens/tokens.css`.
- **Link from the city.** Open `/shops/vault/` from a building, or load it in an iframe. The
  `data-testid` attributes are stable (`connect`, `guest`, `create`, `rules`,
  `atk-mine-<id>`, `atk-shared-<id>`, `verdict`, `board`).
- **Backend.** `backend/src/app.js` has one line, `vault.register(app, { limiter, globalCap })`.
  The routes live in `backend/src/vault.js`. The deployment is the `vault` section of
  `shared/deployments/testnet.json`.
- **Env.** `ARENA_AGENT_KEY` turns on the shared runner. It is the propose-only key of the shared
  arena charter. Without it, `/api/vault/attack` returns 503 and the page says the shared runner
  is off. The rest still works.

## Tests
- Contract tests: `cargo test` in `contracts/charter_factory` (unit and sandbox).
- Backend tests: `npm -w backend test` (`test/unit/vault.test.js`).
- End to end: `VAULT_E2E=1 npx playwright test -c e2e/playwright.config.js e2e/vault.spec.js`.
  This uses a fresh faucet account. It writes `judges/proofs/vault-e2e.json` and
  `e2e/shots/vault-*.png`.
