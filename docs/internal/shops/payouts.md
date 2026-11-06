# Payouts (`payouts`) — Real-World Money

**Track:** Real-World Money (track 8). Illia “universal checkout” maps here + Ferry (internal note).
**Judges score:** invoice paid in any token → exact merchant asset; payroll rows under caps; CSV; honest “not sent” vs live.
**Read first:** `docs/internal/shops-blueprint.md`.

## What exists today

| Piece | Cite | Gap |
|---|---|---|
| Tray | `deep.js` `mountPayouts` L696–826 — rows, CSV, receipts **not sent** on board | Board path prepares only (`shopui.js` APPS.payouts: “live board signs propose only, so this page did not send it”) |
| Logic | `D8_shops/js/payouts.js` (`prepareRows`, `splitAssets`, `receiptsFor`) | USDC rows capped conceptually ≤0.20 USD; not settled |
| Standalone | `app/shops/payouts/` | Judge page |
| Proof | visitor propose `4jEjzpiY…` as stand-in | Need 3 live pays + 1 refuse + 1 invoice SUCCESS |

## Target experience

- Tabs **Payroll / Invoice / CSV**. AI: “Pay these three”, “Make invoice for 0.15 USDC”, “Export CSV”.
- Payroll: 3 USDC or NEAR rows via `propose` / `propose_call`; over-cap row refused on chain; others pay.
- Invoice page: payer uses 1Click ANY_INPUT or EXACT_OUTPUT; status paid/pending/refunded with links.
- Raised CTAs; AI dock; no text-on-text.

## AI commands

- “Prepare payroll” / “Send payout 1” under session.
- “Create invoice 0.15 USD on Base USDC” → checkout quote ≤0.20.
- “Export accountant CSV”.

## Live data

- 1Click quotes/status — https://docs.near-intents.org/…/making-a-request · check-swap-execution-status (200).
- Board row caps.
- Optional meta-tx stretch: https://docs.near.org/protocol/transactions/meta-tx (200).

## Contract changes

- Prefer board `propose` / `propose_call` only. Invoice may be API+1Click without new wasm.
- Teardown: board `close_charter` refunds unspent.

## Competitors

Settle https://github.com/MFrancis-dev/settle (200) — any-token invoices to dollars. Scrim payment links. Beat with: on-chain cap refuses + city agent session + CSV matching txs. Do not claim exact-dollar if not built.

## Sources

1. 1Click ANY_INPUT / EXACT_OUTPUT — intents docs (200).
2. depth-plan-v2 §4; track Real-World Money prompts.
3. Illia universal checkout idea — deepen invoice CTA only.
4. Access keys — docs.near.org access-keys.
5. Ferry lessons: bridge minimum, checkout cap 0.20, wrong recipientType, seal hygiene, AI executes.

Icons if showing assets: same libraries as `ferry-icons-fix.md`.

## Acceptance

- [ ] 3 real payout txs + 1 on-chain refusal.
- [ ] 1 invoice ≤$0.20 reaches SUCCESS or honest pending with status poll.
- [ ] CSV matches txs.
- [ ] City browser + tests; README honest about prepare vs send.
