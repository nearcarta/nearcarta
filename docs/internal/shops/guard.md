# Guardhouse (`guard`) — AI Security

**Track:** AI Security (track 6). **No** Social Money.
**Judges score:** on-chain hard caps + visible allow/refuse; FC-key honesty; counterparty allow/warn/block; injection demo; OutLayer attestation if claimed.
**Read first:** `docs/internal/shops-blueprint.md`, then this file. Do not re-scan the whole repo.

## What exists today (honest)

| Piece | Path / cite | Gap |
|---|---|---|
| City tray | `deep.js` `mountGuard` L571–601 — account input, example payee, check button, score list | Thin UI vs Ferry mix tray; no AI dock character |
| Score logic | `app/src/guard-score.js`; API `GET /api/guardhouse/check/:acct` → `backend/src/guardhouse.js`, `counterparty.js` | Live signals exist; warn→human confirm path is partial in APPS.guard |
| Injection / trick | `shopui.js` APPS.guard `run`/`send` → `A.trickPlan` / `A.trickSend` | Works as charter propose path; lamps must bind to **real** contract error strings |
| Board refusals (proof) | `mainnet.json` / README: over cap `CcPMX1Dt…`, off list `E7KMexjS…` | Good; keep linked |
| OutLayer | `backend/src/outlayer.js` — `enabled: false` when `DEP.outlayer` missing; **no** `outlayer` key in `mainnet.json` today | **P0 gap:** no live attested run |
| Room | `D8_shops/shops/guard.js` | Cinema present; deepen with Ferry-pattern dock |

## Target experience (Ferry pattern)

- City door → Guardhouse room. Left tray tabs e.g. **Check / Trick / Freeze**. Opaque fields, raised CTAs.
- AI guard character opposite side; chat commands under caps (see below).
- Lamps light from real refuse reasons; freeze drill shows chained hands; unfreeze restores.
- Cinematic refuse only when chain/API actually refused; clear seals on new check.

## In-shop AI commands (under caps)

- “Check shop-moved-pay-here.near” → same as Check CTA.
- “Try poisoned invoice” → trickPlan + checkPayee; on allow/warn follow existing send rules.
- “Freeze my row” / “Unfreeze” → `set_frozen` via session when key allows (gas only on board methods that need no deposit, or setup approval if required).
- Never open a wallet popup for checks that are view-only.

## Live data sources

- NEAR RPC account age / code hash via guardhouse backend.
- `shared/guard/denylist.json`.
- Board `propose` refuse strings.
- OutLayer HTTPS or `request_execution` when enabled: https://app.outlayer.ai/docs/getting-started (200).

## Contract / config changes

- Prefer **no** board wasm change. OutLayer needs deploy config in deployments + secrets; **mainnet OutLayer contract id was UNVERIFIED in depth-plan-v2** — confirm in OutLayer docs before writing it.
- Teardown: board row `close_charter`; OutLayer project cleanup per their docs.

## Competitors to beat (internal)

Kept in private notes on the box, not in this repo.

## Sources (every plan point)

1. Live OutLayer run + attestation shown in tray.
   - Source: https://app.outlayer.ai/docs/getting-started
2. Counterparty allow/warn/block with human gate on warn.
   - Source: track prompt AI Security; `backend/src/counterparty.js`
3. Injection demo lamps ← contract errors; log page.
   - Source: `contracts/charter_board` `propose`; README refuse txs
4. README FC-key limits (one receiver, gas allowance, lockout).
   - Source: https://docs.near.org/protocol/accounts-contracts/access-keys
5. Freeze drill mainnet.
   - Source: `set_frozen` L174
6. Ferry-pattern AI dock + tabs.
   - Source: `shops-blueprint.md` Ferry pattern; `ferry-dock.js`

Partner hub: https://docs.near.org/llms.txt · https://github.com/near/agent-skills/tree/main/skills · https://nearhackathon.com/#tracks · https://github.com/nearai/near-hackathon-prompt-examples

## Acceptance / live proof the assistant will run

- [ ] One OutLayer run with attestation linked **or** honest README that OutLayer is off (no fake enabled).
- [ ] One injection refused on mainnet with nearblocks link.
- [ ] Warn path requires human confirm before propose.
- [ ] Browser city test + screenshots; tests green.
