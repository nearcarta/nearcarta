# zcash-devtool rebuilt for NU7

NU7 (ZIP 259) activates on Zcash mainnet at height **3,543,405** (around Nov 6, 2026). On earlier network it activated at 4,465,026. After NU7, a wallet tool built on the old consensus parameters stops following the chain. NU7 also lowers block spacing to 25 s (ZIP 318: `NU7_POW_TARGET_SPACING_RATIO = 3`).

## What was built

- Base: zcash-devtool `0b3436b` (upstream main has no NU7 port yet).
- librustzcash pinned to the NU7 release merge `d0f78998c91f1659d48f39c82ed3c16bd319bb31`, which includes the mainnet height fix `f53a9b4`. Crates: zcash_protocol 0.11.0, zcash_address 0.14.0, zcash_transparent 0.11.0, zcash_primitives/zcash_proofs 0.31.0, pczt 0.10.0, zip321 0.10.0, zcash_keys 0.17.0, zcash_client_backend 0.25.0, zcash_client_sqlite 0.23.0, zcash_pool_migration 0.2.0.
- Source port for the API changes, in `zcash-devtool-nu7.patch` (7 files, +71/-79):
  - `inspect/transaction.rs`: sighash through `PrecomputedSighashData::new(tx)`.
  - `pczt/inspect.rs`: `PrecomputedSighashData::new_zip244`; accepts tx versions V5 and V6.
  - `pczt/update_with_signature.rs`: transparent signing via `PrecomputedSighashData<EffectsOnly>`.
  - `pczt/pay_manual.rs` and `migration/advance.rs`: `zip318::BlockSpacing::for_network`.
- Checked in the pinned source (`zcash_protocol/src/consensus.rs`): mainnet `Nu7 => 3_543_405`, earlier network `4_465_026`, spacing ratio 3.
- `cargo build --release`: OK. The binary is 103,942,752 B, sha256 `62a6364ac1f0207801d423a4f37af608d09c88b3e2b8fc2b9ce99a08f770a910`.

## Verification (earlier network, on a copy)

A copy of a earlier network payee wallet, never the bank wallet, was synced with the new binary: `ChainTip(4549566..4552389)`, 77/77 ranges. That range is past earlier network NU7, so the new tool follows the NU7 chain.

The live bank wallet was not opened with the new binary. Its sqlite DB would be migrated forward and the old binary could no longer read it.

## Switching the Mist Bank worker (later, no code change)

The worker script is not in this repo. The Zcash leg is not run from this API. To switch a worker that still exists outside the repo:

1. Copy the bank wallet dir and run `sync` and `balance` on the copy with the new binary.
2. Stop the worker if it is still running outside this repo.
3. Set `ZCASH_DEVTOOL=<nu7 build>` in the worker env file, then `start`.

Do this before mainnet height 3,543,405. Rollback: restore the wallet dir copy and unset `ZCASH_DEVTOOL`.
