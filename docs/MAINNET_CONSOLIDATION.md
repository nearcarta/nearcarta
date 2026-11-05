# Mainnet consolidation plan

Update: after the extra 10 NEAR, all five contracts are live on mainnet. See Part C. The plan below is the original costing.

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

The initial state of each contract and about 0.01 NEAR of gas per deploy come on top of this. See Part C for the measured state and the mainnet deploy.

## Part C: mainnet deploy (live)

Script `backend/scripts/extras-deploy.js`. Testnet run first, then mainnet (`judges/proofs/extras-mainnet-deploy.json`). Root `nearcarta.near` after: 1.491207 NEAR.

| Contract | Init state bytes | Locked | Balance | Full-access key |
|---|---|---|---|---|
| arena.nearcarta.near | 279 | 3.6993 | 3.7300 | deleted |
| house.nearcarta.near | 268 | 2.4720 | 2.5028 | deleted |
| townhall.nearcarta.near | 195 | 1.9223 | 1.9523 | kept (no owner close) |

Checks on mainnet:
- Arena: agent pay 0.001 returned `ALLOW` (`AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht`); pay 0.002 refused with `C1_CAP` (`25LpJRFF6ugmRdF8eH7Rw7dpkMthQjG6XWXFyx9mqa6V`).
- House deed: pay 0.001 under a 0.001 cap passed (`83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26`); 0.002 failed (`3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1`).
- Town Hall: reward 0.001 passed (`6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h`); 0.002 failed on the per-reward cap (`Cp2rWatnDBHRhbmGdrNqFbr14tg42TW4cAMTjp4Bsnu6`).

## Teardown (every NEAR recoverable)

- Arena and house: owner (`nearcarta.near`) calls `close()` with 1 yocto; it deletes the account to the owner. House first needs its purse emptied (`house_pay` of the full balance). `TEARDOWN=1 ONLY=arena,house` in the script does both.
- Town Hall: no owner close, so its full-access key is kept at `~/.near-credentials/mainnet/townhall.nearcarta.near.json` (box only, mode 0600). `TEARDOWN=1 ONLY=townhall` deletes the account to `nearcarta.near`.
- Charter and toll: as in `docs/MAINNET_RUNBOOK.md`.
