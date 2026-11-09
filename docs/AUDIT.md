# Contract audit, 2026-11-09

Scope: the six contracts live on mainnet (`contracts/deployed.json`). Method: the near-contract-audit
detector list (non-private-callback, reentrancy, argument and return types, unsaved changes, owner
checks, yocto-attach, storage collision, init macro, gas griefing, insecure randomness, prepaid gas,
storage cost, unsafe and float math), each hit checked by hand for a real path before it was graded.
Every High and Medium below is fixed in source with a unit test that fails on the old code.

| # | Contract | Sev | Finding | Fix |
|---|----------|-----|---------|-----|
| B1 | board | High | `set_effects` set then clear refunded more than it took, so a row owner could cycle it and drain the board's free balance (6 cycles paid out 0.01266 NEAR). | Shrink refunds only the row delta plus the deposit; `an_effect_set_and_clear_cycle_pays_nothing_out`. |
| B2 | board | Medium | Partial-mode ledger counted the side reserve twice (in `storage_locked` and again as credit), so `owed` drifted above the rows. | `release` no longer subtracts credit; holds and effects move `owed` by the row delta; `the_partial_ledger_matches_the_rows_after_effects_and_holds`. |
| B3 | board | High | `on_paid` / `on_called` callbacks had no caller check (raw exports). | `ERR_PRIVATE` unless the board calls itself; `a_stranger_cannot_call_the_payment_callbacks`. |
| B4 | board | High | Loosening a row (`set_rules`, `set_seal`, `set_agent`, `set_calls`, `set_effects`, `set_confirm_key`, `force_close`, unfreeze, `upgrade`) worked from a function-call key. | 1 yocto required; freezing still works from any key. |
| G1 | guard | Medium | `pay` settled the board action before knowing the NEAR transfer landed; a bounced transfer left NEAR stranded on the guard while the action read as paid. | Transfer then `on_forward` (guard-only): settle on success, `refund_action` with the amount on failure. |
| G2 | guard | Low | `clear` needed no full key. | 1 yocto. |
| T1 | toll | High | `set_price` (it names the board), `withdraw_surplus`, `unfreeze` and `upgrade` worked from an owner function-call key. | 1 yocto on each. |
| T2 | toll | Medium | `close` looped over every order ever opened, so it could outgrow the gas limit. | Loop removed; every open or signing order holds its fee in `service_held`, which `close` already requires to be 0. |
| T3 | toll | Low | `Order.opened_at`, `Price.hold_ns` were raw u64 in JSON. | `U64` (same Borsh layout). |
| H1 | house | High | `on_house_pay` credited the purse back whenever the deed's epoch had moved, even when the transfer had landed. Pay, then release the deed through an inheritance line you control, and the purse is paid twice out of other deeds' NEAR. | A landed transfer is always paid; only a bounced one returns; two tests. |
| H2 | house | High | A sold deed kept the seller's inheritance line, so the seller's guardians could release it to the seller's heir after the sale. | `nft_transfer` / `nft_transfer_call` drop the line and the checked send and bump the epoch. |
| H3 | house | Low | Line times, vault caps and prepared values were raw u64/u128 in JSON. | `U64` / `U128`; the app reads `pending_ns` as a number. |
| H4 | house | Medium | Every purse payment leaves its `action_id` (up to 80 B) in `seen`, and `house_set_vault` took payee and asset strings of any length. Nothing pays for those bytes, and they are staked from the balance that holds every holder's purse (live spare over storage + purses: 0.012 NEAR). A holder could stake other holders' purses away until a payout failed. | Payee <= 100 B, asset <= 16 B, prepared `action_id` <= 80 B; every write that adds bytes requires balance >= storage stake + `held` (`ERR_FLOAT`). `free_writes_cannot_stake_away_the_purses`. Source only. |
| A1 | arena | High | `set_oath`, `set_agent` and unfreeze worked from a holder function-call key, so a leaked session key could point the pot at a new agent or allow list. | 1 yocto; freezing still works from any key. |
| A2 | arena | Low | `close` returns every pot to the owner, including NEAR others added with `fund`. | Documented on `fund`: pots are prize money, not deposits. |
| A3 | arena | Low | The season tiebreak seed is chosen by the owner (commit-reveal, no block randomness). | Accepted: it only orders ties and anyone can recompute it. |
| W1 | hall | High | `migrate` trusted an `owner` argument (fixed on chain earlier, see `contracts/hall/HOTFIX.md`). | Live since `71QKJYqc…`. |
| W2 | hall | Medium | After `refund`, an open part could still be awarded and paid from another part's escrow. | Refund closes unawarded parts; `accept` requires unlocked escrow. |
| W3 | hall | Low | Jobs and stakes were never removed, so `close` could not stay bounded. | `prune` for finished jobs and zero stakes; `close` requires both maps empty. |

Not findings after checking: reentrancy (every callback contract writes its state before the
promise), init macros (`#[init]` / `PanicOnDefault` everywhere; house `migrate_from_v2` refuses any
caller but itself), storage collisions (distinct prefixes), prepaid gas (toll `sign_cross` and board
calls check it), float math (none).

## Which fixes are live

The source fixes ship with each contract's next deploy, built reproducibly (`contracts/deployed.json`
names the recipe, and the `reproducible` CI job rebuilds and compares). The board (B1, B2, B3, B4) and
arena (A1) deploys are held to ride with the next board and arena deploys the game work needs; see
`docs/NEXT_BOARD_DEPLOY.md`.
