# Nearcarta shops blueprint (shared map for Cursor chats)

**Internal.** Do not link from README, site, or llms.txt.
**Purpose:** one Cursor cloud chat per shop can reach Ferry depth without re-reading the whole repo. Read this file first, then `docs/internal/shops/<shop>.md`, then only the paths listed for that shop.
**Tracks (8 only):** DeFi, Privacy, Autonomous Business, AI Security, Agent Economy, Real-World Money, Games, Open Innovation. **No Social Money. No Sputnik DAO claim.** Town Hall is agent governance with **no** Social Money track claim.
**Source rule:** every plan point in a shop brief cites a URL or a repo path that was opened. Unknowns are marked **UNVERIFIED**.

## City story (one paragraph)

Nearcarta is one brown city. A visitor funds NEAR once in `/setup`, writes hard rules on `board.nearcarta.near`, and walks door to door. The Ferry moves value across chains under those caps. Mist Bank proves private AI and sealed amounts. Guardhouse blocks unsafe payees and injection. Toll takes a tiny pass and proves a chain-signature. Chronicle is the public ledger of every allow and refuse. Arena is the red-team game where the same rules refuse a scam on chain. Payouts prepare payroll and invoices. Your House is the deed that owns a purse. Town Hall is where the visitor tightens their own row and posts agent jobs. Every shop uses the same session: one agent key, no wallet popup after setup, refuse seals when a rule bites, and every contract can return unspent NEAR to `nearcarta.near` on teardown.

## Shop → track map

| Shop id (`mountShop` / `APPS`) | Building name | Track(s) | Mainnet account(s) |
|---|---|---|---|
| `ferry` | Ferry | DeFi | no shop contract; uses `board.nearcarta.near` + 1Click + `wrap.near` |
| `bank` | Mist Bank | Privacy | `board.nearcarta.near` (+ TEE / optional ZEC street) |
| `guard` | Guardhouse | AI Security | `board.nearcarta.near` (+ OutLayer when enabled) |
| `toll` | Toll Bridge | Autonomous Business | `toll.nearcarta.near` |
| `chronicle` | Chronicle | Autonomous Business | feed from board txs (no own contract) |
| `arena` | Vault Arena | Games | `arena.nearcarta.near` |
| `payouts` | Payouts | Real-World Money | `board.nearcarta.near` (+ 1Click for invoices) |
| `house` | Your House | Open Innovation | `house.nearcarta.near` + board row |
| `hall` | Town Hall | Agent Economy (**not** Social Money) | `townhall.nearcarta.near` + board row rules |

City entry is primary (`/design/D9_world/`). Standalone `/shops/<id>/` pages are judge/backup only.

## Architecture map (exact paths)

### Shared (every shop)

| Layer | Paths |
|---|---|
| City world | `app/design/D9_world/js/main.js`, `shops.js`, `world.css`, `index.html` |
| Shop room UI | `app/design/D8_shops/js/shopui.js` (`APPS`, `mount`), `app/design/D8_shops/js/apps.js`, `app/design/D8_shops/js/core.js` |
| Deep tray mounts | `app/src/panels/deep.js` (`mountShop` L959–979) |
| Setup / session | `app/house/setup.js`, `shared/board/session.js`, `shared/setup/rules-diff.js` |
| Board contract | `contracts/charter_board/src/lib.rs` — `open_charter` L137, `set_rules` L166, `set_frozen` L174, `set_seal` L182, `set_agent` L190, `close_charter` L208, `force_close` L214, `propose` L234, `set_calls` L293, `propose_call` L319 |
| Deployments | `shared/deployments/mainnet.json` |
| Backend entry | `backend/src/server.js`, `backend/src/config.js` |
| Tests root | `backend/test/unit/`, `e2e/` |

### Per shop (frontend city tray · standalone · API · contract · tests)

| Shop | City / room | Standalone judge page | Backend | Contract | Tests (examples) |
|---|---|---|---|---|---|
| ferry | `deep.js` `mountFerry`, `ferry-dock.js`, `ferry-pair.js`, `ferry-settle.js`, `D8_shops/shops/ferry.js` | `/shops/ferry/`, `/ferry-widget` (`ferry-pay.js`) | `ferry.js`, `ferry-checkout.js`, `ferry-guard.js` | none (board + wrap.near) | `ferry-*.test.js`, `e2e/ferry-checkout.spec.js` |
| bank | `deep.js` `mountBank`, `D8_shops/shops/bank.js` | `/shops/bank/` | `mistbank.js`, `tee.js`, `ai.js`, `zcash.js` | board row | `mistbank.test.js`, `tee` proofs |
| guard | `deep.js` `mountGuard`, `guard-score.js`, `D8_shops/shops/guard.js` | `/shops/guard/` | `guardhouse.js`, `counterparty.js`, `outlayer.js`, `board-guard.js` | board + optional OutLayer | guard unit tests |
| toll | `deep.js` `mountToll`, `toll-derive.js`, `D8_shops/shops/toll.js` | `/shops/toll/` | `tollgate.js`, `toll-pass.js` | `contracts/toll` → `toll.nearcarta.near` | toll contract + unit |
| chronicle | `deep.js` `mountChronicle`, `chronicle-feed.js`, `D8_shops/shops/chronicle.js` | `/shops/chronicle/` | `board-chronicle.js`, `ledger.js`, `txindex.js` | none | chronicle unit |
| arena | `deep.js` `mountArena`, `arenalive.js`, `D8_shops/shops/arena.js` | `/shops/arena/` | `arena.js`, `vault.js` | `contracts/arena` → `arena.nearcarta.near` | arena cargo tests |
| payouts | `deep.js` `mountPayouts`, `D8_shops/js/payouts.js`, `D8_shops/shops/payouts.js` | `app/shops/payouts/` | (board propose path in apps) | board | `d8-payouts.test.js` |
| house | `deep.js` `mountHouse`, `deed.js`, `hall.js` helpers, `D8_shops/shops/house.js` | `app/house/`, `/shops/house/` | (row read APIs) | `contracts/house_nft` → `house.nearcarta.near` | house unit |
| hall | `hall-ui.js` `mountHall`, `D8_shops/shops/hall.js` | `app/shops/hall/` | (market listing later) | `contracts/townhall` → `townhall.nearcarta.near` | hall / townhall tests |

`mountShop` ids and aliases (`deep.js` L959–971): `ferry`, `guard` (`guardhouse`), `toll`, `chronicle`, `arena`, `payouts`, `bank` (`mist` / `mistbank`), `house`, `hall` (`townhall`).

## Session model (every shop)

1. Visitor signs in `/setup` once. A function-call key is added with `receiver_id = board.nearcarta.near` (gas only; **cannot** attach NEAR deposit).
   - Sources: https://docs.near.org/protocol/accounts-contracts/access-keys (200); https://docs.near.org/web3-apps/tutorials/wallet-login#function-call-keys-at-login (200).
2. One approval opens a row: `open_charter{rules, agent, fund}` and writes `set_calls` allowlist + caps. Live rows update with `set_rules` / `set_calls` / `set_agent` without closing (`set_rules` L166, `set_calls` L293).
3. After that, the agent ed25519-signs `propose` / `propose_call` under caps. **No wallet popup.** Cinema / seals reflect the real on-chain decision.
4. Caps that must hold for Ferry-class actions: `per_action_cap` ≥ action size, receivers / CALLS include the needed contract+method (e.g. `wrap.near` `near_deposit` / `storage_deposit` / `ft_transfer`), row balance ≥ deposit, expiry long enough.
5. Proof record lives in `shared/deployments/mainnet.json` (`board`, `board.visitor_run`, per-shop `extras.*`).

Code refs: `app/house/setup.js`; `shared/board/session.js` (`FERRY_CALL_TARGETS`, `callPolicy`); `app/design/D8_shops/js/apps.js` (`boardPay`, `ferryProposeCalls`); contract lines above.

## Teardown rule

Every Nearcarta contract must return funds to `nearcarta.near` (or refund the visitor) and leave no stranded balance:

| Account | How |
|---|---|
| `board.nearcarta.near` | visitor `close_charter`; owner `force_close` / `reap` (see `docs/MAINNET_BOARD.md`) |
| `toll.nearcarta.near` | owner `close()` 1 yocto |
| `arena.nearcarta.near` | owner `close()` 1 yocto |
| `house.nearcarta.near` | owner `close()` 1 yocto (refuses while purse > 0) |
| `townhall.nearcarta.near` | `delete_account` with the stored key (still has 1 FAK — note in `mainnet.json`) |
| `charter.nearcarta.near` | town oath path; sweep / delete FAK already recorded |

Ferry has **no** shop contract. Row NEAR returns on `close_charter`. 1Click incomplete deposits follow 1Click REFUNDED, not board.

## FERRY REFERENCE PATTERN (copy methods, not holes)

Every shop aiming for 10/10 must match this **shape**:

1. **City entry primary** — door in D9 world opens the D8 room + deep tray. Standalone `/shops/...` is backup.
2. **Mix tray** — left tabs (Ferry: Swap / Routes / Rules). Opaque spacious menus. No text-on-text. Small raised 3D gold CTAs with ≥12px gaps (`panels.css`, `world.css` `body.ferry-tray`).
3. **AI Agent character** on the opposite side (`robotexpressive.webp`), opens a popup chat with Send **inside** the card. Enter **and** arrow send. Input clears. Log shows a plain hint on miss (`ferry-dock.js`, `shopui.js` `ensureFerryDock`).
4. **Live non-hardcoded data** — tokens/quotes/feeds from APIs or chain views, not frozen demo pairs as the only path.
5. **Real icons** — hero, pills, and every dropdown option show the picked asset + chain badge (see `ferry-icons-fix.md`). No `?` placeholders.
6. **Manual CTA and in-shop AI run the same live action** under session caps.
7. **Cinematic post-tx only on real SUCCESS** (or honest refuse). Guest/demo paths must not say “delivered”.
8. **Refuse seal hygiene** — hide “Downgrade refused” on new quote / success; show only on real refuse.
9. **README proof drawer** — exact nearblocks txs, clone/run/verify commands, honest dry vs live wording.
10. **Tests** — unit + (where useful) e2e; `npm test` green before merge.

## LESSONS FROM FERRY (do not repeat)

| Bug | Root cause | Prevention rule |
|---|---|---|
| Cap too small for the action | Row `per_action_cap` 0.005 NEAR while session swap needs ~0.05 | Size caps to the **real** action before claiming agent settle; UI must refuse locally with plain words when under-capped |
| `/setup` could not update a live row | No “Update my rules” / Sign path calling `set_rules`+`set_calls` on an open row | Always expose update on live rows; never require close+reopen for allowlist growth |
| `set_calls` `ERR_RECEIVERS` | Duplicate `(receiver, method)` or >8 pairs (`lib.rs` L296–303) | Dedupe before send (`callPolicy` + tests); never append `FERRY_CALL_TARGETS` twice |
| Expiry silently shortened | Update path rewrote `expires_at` to “now” without asking | Preserve existing expiry unless the visitor picks a new window (`PR #31` lineage) |
| Wrong 1Click recipient / recipientType | Zcash / wrong type sent for a NEAR destination | Use `quoteRecipient` / `cityCheckoutBody` for the **destination chain**; visitor NEAR ≠ depositAddress |
| Gate read visitor as oath | First tried `get_rules` on the visitor implicit account | Visitor rows: always `get_charter` on `board.nearcarta.near`; oath `get_rules` only for per-visitor oath contracts |
| 1Click bridge minimum | e.g. Base USDC you-send below corridor minimum → no depositAddress | Treat bridge-min refuse as non-delivery; do not claim SUCCESS; prefer NEAR-native session wrap path for the primary demo |
| Dock Send not bound | AI Send button / Enter not wired after remount | Re-arm dock after every ferry paint (`installFerryDock` / `armFerryDock`) |
| Stale refuse seal | Cinema showed “Downgrade refused” on every act / success | `hideRefuse` on new quote and on SUCCESS; show seal only on refuse |
| Hard-coded token icons / lists | `TOK` maps ~5–7 symbols; dropdown `<option>` text-only; hero lagged picker (owner picked USDC sol→USDC pol, UI still looked like static pair) | Live 1Click list + icon library for all ~215/38+ chains; hero+pills+options update with picker (see `ferry-icons-fix.md`) |
| “All shops” → standalone page | `D9_world/index.html` links `/shops/...` instead of city room | All-shops entries must `enterShop(id)` in the city, not navigate away |
| Base you-send mistaken as primary | Pay widget / USDC@Base treated as the main journey | Primary: fund NEAR once → session `propose_call` on wrap.near. Base you-send is **optional Pay** only |

## Definition of done — 10/10 checklist (every shop)

- [ ] Live **mainnet** tx proof recorded by the assistant (nearblocks link(s) in README + `mainnet.json` where applicable).
- [ ] Browser hand-test from the **city door** (screenshots of tray + room + AI chat).
- [ ] README section: what it does, txs, clone / run / verify commands; honest about dry vs live.
- [ ] Unit tests (and e2e if UI-critical) green on the PR.
- [ ] Teardown path verified or documented with a prior tx.
- [ ] Every plan point in the shop brief still cites its source.
- [ ] Ferry pattern items 1–8 above met for that shop’s metaphor.
- [ ] No Social Money / Sputnik claim. No fake multi-agent swarm without proof.
- [ ] Spends only with explicit visitor/owner approval naming the amount.

## How to run a shop Cursor chat

1. Attach: this blueprint + `docs/internal/shops/<shop>.md` + (if Ferry icons) `ferry-icons-fix.md` + `competitors.md` + relevant track prompt under `/workspace/audit/tracks/` if present.
2. Scope: **one shop only**. Do not rewrite other shops.
3. Follow the shop brief’s plan; cite sources under each change in the PR description.
4. Merge small PRs; parent hand-tests like Ferry before calling 10/10.

## Partner / docs hub (verified HTTP 200 this run unless noted)

- https://docs.near.org/llms.txt
- https://docs.near.ai/ · https://docs.near.ai/cloud/verification
- https://docs.near-intents.org/ · 1Click making-a-request · verify-quote-signature · check-swap-execution-status · confidential-swaps
- https://docs.agentsonintents.com/integration/agent-api/overview
- https://docs.market.near.ai/list-your-agent · https://market.near.ai/skill/SKILL.md
- https://app.outlayer.ai/docs/getting-started
- https://doc.aurora.dev/ · https://docs.hotdao.ai/
- https://github.com/near/agent-skills/tree/main/skills
- https://github.com/nearai/near-hackathon-prompt-examples
- https://nearhackathon.com/#tracks
- https://1click.chaindefuser.com/v0/tokens (215 tokens / 39 chains this run; **`icon` field currently absent on all rows** — library fallback required)
- Icons: https://github.com/spothq/cryptocurrency-icons (CC0); https://github.com/0xa3k5/web3icons (`@web3icons/core`, MIT); registry https://registry.npmjs.org/@web3icons/core (200). npmjs.com package page returned 403 to curl — use registry/GitHub.

**Dropped on purpose:** Social Money track, Sputnik/Trezu as a track claim (links may still appear as “do not rebuild” references in competitor notes only).
