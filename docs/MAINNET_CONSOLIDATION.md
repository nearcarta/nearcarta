# Mainnet consolidation plan (costed, not executed)

Budget: 6.7 NEAR on one implicit account. NEAR storage costs 1e19 yoctoNEAR per byte (0.01 NEAR per KB). Lock figures are measured on testnet; the plan totals are arithmetic.

## What each piece locks alone

| Piece | Locks | Recoverable | Source |
|---|---|---|---|
| charter (oath.r18) | 4.024 | yes (reaper path) | rehearsal 3 |
| toll (toll.v6) | 2.278 | yes (`close()`) | rehearsal 3 |
| arena | ~3.45 | only if it has a delete path | testnet account |
| house deed | ~2.09 | only if it has a delete path | testnet account |
| Town Hall (DAO factory instance) | ~5.48 | no owner delete path | testnet account |
| **all five, separate** | **~17.3** | | over budget by ~10.6 |

## Options

1. **Core only (current runbook).** Charter and toll lock 6.302 and peak at 6.437 of 6.7. Arena, house and Town Hall stay on testnet. Fits, and is fully recoverable. **Recommended.**
2. **Fold arena and house into the charter.** Code is paid per byte, so merging saves only duplicated SDK and serde code. That is likely tens of KB, not MB. A merged charter would still be about 4.0 plus most of 3.45 plus 2.09, so it **does not fit** next to the toll. It also widens the charter's attack surface: one upgrade key would govern spending policy and game logic. This weakens the security split, so it is not recommended.
3. **One shared contract for arena, house and Town Hall** instead of the charter. Still about 9–11 NEAR, so it does not fit.
4. **Town Hall as plain charter clauses** (owner plus policy delay, no DAO instance). This costs no extra storage beyond the clause state, but it is not a DAO. Saying "DAO on mainnet" after this would be untrue.

Honest conclusion: **"everything on mainnet" does not fit in 6.7 NEAR** under any layout that keeps the charter/toll security split. Only option 1 is both in budget and fully recoverable.

## Stays off-chain or on testnet under option 1
Arena, house deed and Town Hall stay on testnet, along with the shops UI state and the Privy login (the wallet keys are held by Privy, not by these contracts).

## Still open
- Contract-enforced tier limits and the Mist amount: **not started**. Today they are enforced by the UI and backend only. They are needed before option 1 counts as complete.
- Reproducible builds: blocked by Docker DNS on the box.

## Part B: extra NEAR per contract after size optimization

Built with near-sdk 5.27.0 (standards 5.27.0), rustc 1.86, cargo near, then `wasm-opt -Oz` with debug and producer sections stripped. Every host import is also imported by the live p86 charter or toll, except `block_index`, an old basic function. Storage costs 0.00001 NEAR per byte, and each account adds 100 bytes.

| Contract | File | Bytes | Code + account lock (NEAR) |
|---|---|---|---|
| Arena | `arena.p86.wasm` | 368,180 | 3.6828 |
| House deed | `house_nft.p86.wasm` | 245,996 | 2.4610 |
| Town Hall | `townhall.p86.wasm` | 191,351 | 1.9145 |
| All three | | 805,527 | 8.0563 |

The initial state of each contract and about 0.01 NEAR of gas per deploy come on top of this. The state has not been measured on chain yet. These builds have not been deployed to mainnet.
