# Chronicle (`chronicle`) — Autonomous Business

**Track:** Autonomous Business (public ledger half of the business loop).
**Judges score:** every sale/cost/payout visible with tx hashes; CSV/JSON export; verify entry.
**Read first:** `docs/internal/shops-blueprint.md`. Pair with Toll brief for the full loop.

## What exists today

| Piece | Cite | Gap |
|---|---|---|
| Tray | `deep.js` `mountChronicle` L623–678 — search, filter, pages, CSV, verify | Functional but not Ferry-pattern (no AI dock, cramped risk) |
| Feed | `app/src/chronicle-feed.js` (`queryFeed`, `exportCsv`, `verifyEntry`, `RECORDED`) | Relies on recorded + API feed |
| Backend | `backend/src/board-chronicle.js`, `ledger.js`, `txindex.js` | Ensure mainnet board txs index cleanly |
| Room | `D8_shops/shops/chronicle.js` | Deepen presentation |
| Proof | allowed propose `8WDqBeaN…` cited in README | Need full business-loop entries when Toll/Ferry settle |

## Target experience

- Tabs **Feed / Export / Verify**. AI: “Show refuses today”, “Export CSV”, “Verify this hash”.
- Each row: decision, shop, amount, nearblocks link.
- Auto-ingest from Toll sale, Ferry SUCCESS, Payouts, Guard refuses.

## AI commands

- “Show refused payments” → filter denied.
- “Export today’s ledger” → CSV download.
- “Verify &lt;tx&gt;” → verifyEntry + explorer link.

## Live data

- Board history / indexer APIs already used by chronicle-feed.
- Optional: intents explorer https://explorer.near-intents.org (200) for Ferry fills.

## Contract changes

- None required for read path. Business loop writes stay on board/toll.
- Teardown: n/a (no funds in Chronicle).

## Competitors

Trezu / NEAR Business treasury UIs; Shore. Beat with: **agent-capped** entries + refuse rows + one-click verify.

## Sources

1. Track Autonomous Business loop (sale → inference → split → ledger) — depth-plan-v2 §7; hackathon prompts https://github.com/nearai/near-hackathon-prompt-examples (200).
2. Illia mapping: encyclopedia/markets is a **weak** fit — do not build prediction markets here (`illia-ideas` internal note).
3. Board propose/refuse as ledger truth — `charter_board`.
4. Ferry pattern + lessons (seal hygiene N/A; do apply city entry + AI dock).

https://docs.near.org/llms.txt · https://docs.near.ai/ · https://nearhackathon.com/#tracks

## Acceptance

- [ ] Full loop appears in Chronicle in &lt;2 minutes once Toll path is live.
- [ ] CSV matches on-chain txs.
- [ ] City browser test; unit tests for search/filter/export/verify.
