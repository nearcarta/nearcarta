# Shop modules: Charter office and Vault Arena

Self-contained. Nothing in `app/design` or `app/src` is changed.

## What it is
`/shops/vault/` has three tabs: **My charter**, **Shared arena** and **Leaderboard**.

**My charter**
1. **Connect** through NEAR Connect (`@hot-labs/near-connect`, testnet). There is also an optional
   guest wallet: a new account from the public testnet faucet. Its key is made in the browser and
   stays in that browser's localStorage. The backend never sees it.
2. **Create a charter.** The wallet signs `create_charter(name, policy_delay_ns, dao?)` on the
   factory with a 0.3–5 NEAR deposit. The timelock defaults to 24 hours (10 minutes to 30 days);
   the DAO is optional. The factory creates `<name>.<factory>`, points it at the global R16 oath
   code by hash, and makes the visitor the owner.
3. **Rules and agent key.** One wallet approval sends `set_clause("pay", …)` and
   `set_agent_key(pk)`. The agent key is made in the browser, saved as *pending* before the wallet
   signs, and promoted once the chain shows it. It can only call `propose`. While setup is open
   both apply at once; adding the key closes setup. After that, loosening a rule or a new key waits
   the timelock and is listed with Apply (`execute_change`) and Cancel (`cancel_change`). Keys on
   chain that this browser does not hold can be revoked (`revoke_agent`).
4. **Dashboard.** Gauges for spent today against the daily budget and payments today against the
   daily count (the UTC day, from `get_usage`), and a Freeze button (`freeze` / `unfreeze`; with a
   DAO set, only the DAO can unfreeze).
5. **Ask the agent to pay** (the first card once the agent key is live). A plain-language request,
   for example "pay the cafe 0.01 NEAR for team coffee", is read by the NEAR AI model in a TEE
   (`POST /api/vault/ask/plan`, `backend/src/agent.js`) into one `propose` with memo `ask:<tag>:<note>`; if that
   fails, the browser parser `shared/vault/ask.js` is used and labelled as the fallback.
   The charter decides. These payments are real but are not scored. Two fixed honest jobs
   (`task-mine-<id>`) are scored.
6. **What happened.** A one-line story ("Your agent tried 5 payments: 4 allowed, 1 refused: …")
   plus a log with tx links for every payment tried in the tab.

**Shared arena.** One grid of honest jobs and scams, with a target toggle: *My charter* (the
browser signs with the agent key) or *Shared arena* (no wallet; the server's runner key signs).
Run honest jobs first, because scams spend the day's limits.

**Leaderboard**, rebuilt from chain.

## API (backend/src/vault.js)
| Route | What it does |
|---|---|
| `GET /api/vault/config` | factory, code hash, `policy_delay` {default_ns, min_ns, max_ns}, `arena` {charter, merchants}, `attacks`, `tasks`, `runner`, `attack_enabled`, `legacy` (the R14 deployment), `explorer` |
| `GET /api/vault/charter/:id?fresh=1` | facts: owner, dao, policy_delay_ns, setup_open, agent keys, full-access key count, clauses, `pending_changes`, `usage`, `state` (frozen, next_nonce, …) |
| `GET /api/vault/tasks?charter=` | the honest jobs and the receiver and amount each would pay on that charter |
| `POST /api/vault/task` `{task, nickname}` | runs an honest job on the shared arena (runner-signed) |
| `POST /api/vault/attack` `{attack, nickname}` | runs a scam on the shared arena (runner-signed) |
| `POST /api/vault/ask/plan` `{text, charter?}` | "Ask the agent to pay", nothing signed: the plain-words parse (`receiver`, `amount` in yocto, `note`, `memo` `ask:<note>`), `on_allowlist`, `per_action_cap`, and the exact `proposal` your agent key would send to `propose` (nonce and policy version read from the charter). Without `charter` it plans on the shared arena |
| `POST /api/vault/ask` `{text}` | "Ask the agent to pay" on the shared arena (runner-signed, one `propose`, counts against the runner's daily tx cap): `decision`, `reason`, `tx`, `url`. The charter decides; an off-allowlist payee or an amount over the cap comes back `denied` |
| `POST /api/vault/record` `{tx, charter}` | verifies a tx from chain and records it on the board if it counts |
| `GET /api/vault/score/:charter` | per job and scam: counted or not, and why; `score`/`max_score` |
| `GET /api/vault/score?charter=` | alias of the above; with no charter it returns a usage hint (not a 404) |
| `GET /api/vault/leaderboard` | players with `score`, `tasks`, `patterns`, `not_counted`, `verified` (owner) or nickname rows (`server_signed`), `last_tx` |
| `GET /api/vault/runner` | runner allowance, gas per tx (30 Tgas), and transactions left today |

A refusal **counts** only when the tx is final on chain, the proposal matches the scam's plan for
that charter's rules, and the reason is one the scam targets. Otherwise, `why` says why not
(`not_verified_yet`, `not_refused`, `wrong_reason`, …).

## Mist Bank private send queue (backend/src/mistqueue.js)
Render only queues a request. A separate worker on the operator's machine (backend/scripts/mist-worker.js)
holds the Zcash testnet wallet, re-checks every request on chain, and sends after a random delay.
No response ever contains the amount, the salt, the address or a viewing key.

| Route | What it does |
|---|---|
| `GET /api/mistbank/send` | `open` (worker seen in the last 5 minutes), the limits, and the charter code hashes accepted |
| `POST /api/mistbank/send/prepare` `{ua}` | checks the address (testnet, Orchard-only Unified Address) and returns the `memo` (`mbq1:…`, a hash of the address) which goes into one `propose` your agent key sends to your own charter (shop `mistbank`, any clause that allows it) |
| `POST /api/mistbank/send` `{ua, charter, approval_tx}` | 202 `{id, state:'queued', status_url}`. `approval_tx` must be a final `propose` signed by the charter's own agent key and allowed by it: shop `mistbank`, memo = the prepared memo, at most 24 h old, on a charter with an accepted code hash and 0 full-access keys. 503 if the worker is offline; 409 if the approval was already used; 429 for the per-charter, per-IP or daily limit |
| `GET /api/mistbank/send/:id` | `state` queued, waiting, sending, sent or failed (with `error`); when sent, the Zcash testnet `txid`, explorer link and amount `commitment` |

The address is dropped from Render as soon as the worker takes the request.

## Hook it into the city
- **Build.** `app/build.mjs` calls `buildShops(dist, esbuild)` from `app/shops/build.mjs`. The
  output goes to `app/dist/shops/vault/{index.html, vault.css, vault.bundle.js}`. The page reads
  `../../config.js` (`NEARCARTA_API`) and `../../design/D7_system/tokens/tokens.css`.
- **Link from the city.** Open `/shops/vault/` from a building, or load it in an iframe. The
  `data-testid` attributes are stable (`connect`, `guest`, `create`, `rules`, `tab-mine`,
  `tab-arena`, `tab-board`, `ask-text`, `ask`, `freeze`, `gauge-spent`, `story`,
  `task-<mine|shared>-<id>`, `atk-<mine|shared>-<id>`, `target-mine`, `target-shared`, `verdict`,
  `board`). Deep links: `#mine`, `#arena`, `#board`.
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
