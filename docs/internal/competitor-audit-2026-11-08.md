# Competitor audit — NEAR Hackathon 2026

Cloned from GitHub on 2026-11-08 (depth 1). Measured, not guessed.

| repo | track | files | lines | test files | mainnet contract cited | demo video |
|---|---|---|---|---|---|---|
| Townsvilledh/spendguard | 06 security | 1 | 302 | 1 | none | no |
| smog123/Warden | 06 security | 38 | 2757 | 6 | none (testnet) | no |
| Lainholic/project_carerail | 06 security | 39 | 7560 | 7 | **testnet only** (`carerail-274071e4.testnet`) | yes |
| soldanoandrea/allowance | 06 security | 75 | 16683 | 42 | none | yes |
| agadape/undo | 06 security | 31 | 5180 | 7 | none | no |
| dyann1984/hades-omega | 07 economy / general | 101 | 11430 | 54 | none | no |
| BreadchainCoop/saving-circles-near | 12 social | 156 | 16572 | 9 | none | yes |
| jamesOPJ/befewer | 09/11 game | 11 | 5992 | 6 | none | no |

## What the rivals actually ship

Eight repos cloned and counted. The pattern is consistent:

1. **Testnet, not mainnet.** CareRail advertises an "On-Chain Vault Contract" and it is
   `carerail-274071e4.testnet`. Allowance's README uses `example.testnet`, `you.testnet`.
   Every one of the eight cites testnet accounts; none cites a mainnet contract it deployed.
2. **No contract at all, in two of the three biggest security entries.** `smog123/Warden`
   (2,757 lines) and `Lainholic/project_carerail` (7,560 lines) contain **zero** Rust contract
   files. Their "enforcement" is an off-chain policy engine. The track asks for the agent to
   sign with a function-call key scoped to one contract; without a contract there is nothing
   for that key to be scoped to.
3. **Small contract surface.** The most-contracted rivals (`agadape/undo` 8 files,
   `soldanoandrea/allowance` 7) are single-purpose vaults. `Townsvilledh/spendguard` is 302
   lines in one file.
4. **Live apps are thin.** Three of eight have a hosted URL; one of those is a static
   recorded-ledger page, not a running app with a wallet.

## Where Nearcarta actually stands

Measured the same way, on `main` at 6dedbf38:

| | Nearcarta | best rival |
|---|---|---|
| Rust contract crates | **14** (`oath`, `charter_board`, `toll`, `guard`, `house_nft`, `arena_v2`, `hall`, `charter_factory`, `reaper`, `attested_check`, …) | 8 single-purpose |
| Deployed on **mainnet** with recorded txs | **every shop**, 92 proof txs re-read by `npm run verify` | none |
| Rust `#[test]` | **331** | — |
| JS unit tests | **884** | — |
| Browser e2e | **127** | — |
| Per-visitor on-chain budget (`charter_board`) | one row, real caps, real refusals, real holds | none found |
| Cross-chain | 1Click swap recorded on mainnet | testnet/quote-only |

## Where Nearcarta is genuinely behind, stated plainly

1. **The toll cannot cross on mainnet right now.** The per-action hold record does not fit a
   0.02 NEAR row, so a real press is refused `ERR_DEPOSIT` (tx `5GSeuYnM…`, 2026-11-08). The fix
   is staged (`3hpmvSiS…`) and lands 2026-11-09 10:27 UTC. Until then the DeFi track's headline
   action is proved blocked rather than proved working.
2. **The Town Hall cannot advance past `post_job`** for the same reason.
3. **The invoice is not durable.** It lives in a file on a Render host that starts empty
   (`durability` in `/api/payouts/invoices/:id`). A rival that puts the invoice in contract state
   is ahead there, and the README must not claim otherwise.
4. **Two shops are shallow relative to their rivals' depth.** Arena has one pot mechanic where
   `soldanoandrea/allowance` has 42 test files of treasury behaviour. Hall splits one job across
   parts where `dyann1984/hades-omega` has 54 test files.
5. **No demo video.** Three rivals have one. The plan asks for a two-minute demo; a judged
   submission without one is weaker on presentation.
