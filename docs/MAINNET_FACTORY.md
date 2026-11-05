# Mainnet visitor factory

This factory is not the visitor path. Copying the oath wasm onto each charter costs more than `nearcarta.near` can fund, and the stake does not fit a 1 NEAR deploy. The visitor path is the one board in `docs/MAINNET_BOARD.md`. The code below stays so the old cost math can still be read.

# Mainnet visitor factory (retired)

The earlier network factory publishes the oath wasm as a NEAR global contract. That burns about one NEAR per 100 KB and that NEAR does not come back. The mainnet factory does not do that.

`contracts/charter_factory_lock` stores one copy of the oath wasm on the factory account named in `shared/deployments/mainnet.json` (`factory.contract`) and copies it onto each charter with `deploy_contract`. Storage is staked, not burned. Gas is the only NEAR that does not come back.

The account id is `factory.contract` in `shared/deployments/mainnet.json`. It stays `not_deployed` until the owner runs the script below. This repo does not sign that transaction.

## Cost

The protocol locks 10^19 yoctoNEAR per byte.

| What | Comes back |
| --- | --- |
| Oath wasm stored on the factory | Yes, when the factory is deleted |
| The same wasm stored on each charter, plus 8,192 bytes of slack for oath state | Yes, when that charter is deleted |
| 0.01 NEAR registry fee, kept on the factory | Yes, when the factory is deleted |
| Gas | No |

`minDepositYocto` in `shared/factory/lock.js` is the visitor deposit: `(wasm bytes + 8192) * 10^19 + 10^22`. The contract uses the same numbers (`STATE_SLACK`, `REGISTRY_FEE`). A deposit above 10 NEAR is refused.

A global-contract factory would burn the code fee up front and would not meet this. Per charter it would lock less, and that locked part would still come back, but the burned code fee would not.

## Deploy

The owner, from `nearcarta.near`:

```bash
cd contracts/charter_factory_lock && cargo +1.95.0 near build non-reproducible-wasm
node backend/scripts/deploy-mainnet-factory.js
NEAR_MAINNET_SIGNER_KEY='ed25519:...' node backend/scripts/deploy-mainnet-factory.js --live
```

The first command prints the plan and does not sign. `--live` reads the key from the environment, creates the subaccount with no access key, deploys the factory, calls `new({ owner })`, then `set_code` with the oath wasm. Excess storage deposit is refunded by the contract. After the transactions succeed, set `factory.status` to `deployed` and `factory.min_deposit_yocto` to the printed value.

The site creates a charter on that factory only when the build has `NEXT_PUBLIC_MAINNET=1` (or `NEXT_PUBLIC_NEAR_NET=mainnet`) and `factory.status` is `deployed`. Until then `/setup` shows the town's mainnet transactions and does not send a create.

## Teardown

Order matters. NEAR will not delete an account that still has a subaccount.

1. Each charter owner queues the reaper: `queue_upgrade` with the sha256 of `contracts/artifacts/reaper.wasm`, waits out `policy_delay_ns`, then `upgrade` with that wasm, then `reap` with 1 yoctoNEAR attached. The charter account is deleted and its whole balance, including the wasm stake, goes to the charter owner. The reaper reads that owner from the oath state.
2. That owner, or `nearcarta.near`, calls `release` on the factory with the charter account id. This only drops the registry row. It does not move NEAR. Call it after the account is gone.
3. When `list` is empty and nothing is pending, `nearcarta.near` calls `reap` on the factory with 1 yoctoNEAR attached. The factory account is deleted and every remaining yoctoNEAR, including the stored wasm, goes to `nearcarta.near`.

`clear_code` refunds the stored wasm without deleting the factory, and then `create_charter` refuses with `ERR_NO_CODE`.

`reap` refuses while a charter is still registered (`ERR_NONEMPTY`) or the attached deposit is not exactly 1 yoctoNEAR. A stranger cannot call `set_code`, `clear_code`, or `reap`.
