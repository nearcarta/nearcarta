# Mainnet visitor board

One contract holds every visitor's charter. The row key is the visitor's NEAR account. The lock factory in `docs/MAINNET_FACTORY.md` is not this path: copying the oath wasm onto each charter costs more than `nearcarta.near` can fund, and a global contract burns storage that `reap` cannot return.

The account id is `board.contract` in `shared/deployments/mainnet.json`. It is live on mainnet: deploy tx `CaZr8GmMM83WUEESUShTiKtth8PWgxtRTesYGs1mkdpt`, 86,762 bytes, no access key. The proof run is `backend/scripts/board-proof-mainnet.js`.

## What a row stores

Allowlist (at most 8 accounts), per-payment cap, daily budget, payments per day, time window, freeze flag, sealed-rule commitment, and the agent's ed25519 public key. The contract checks a signature over `board-v1|<contract>|<owner>|<receiver>|<amount>|<nonce>`. There is no access key on the board account, so one visitor's key cannot spend another visitor's row.

The refusal strings match the oath charter: `receiver_not_allowlisted`, `zero_amount`, `below_min_amount`, `outside_time_window`, `over_per_action_cap`, `over_daily_budget`, `over_daily_action_count`, `frozen`, `clause_expired`. A sealed rule uses the `oath-hidden-v1` commitment and refuses with `hidden_rule_receiver` or `hidden_rule_cap`.

## What the visitor pays

`open_charter` locks the bytes that row adds to this contract's state, keeps the `fund` argument as spendable balance, and transfers the rest of the attached deposit back. A row over 0.02 NEAR is refused (`ERR_ROW_TOO_BIG`). `close_charter` deletes the row and sends the storage stake plus the unspent balance back to that visitor. The unit test `a_row_costs_at_most_0_02_near_and_the_rest_is_refunded` measures the lock. `close_refunds_the_row_stake_and_the_unspent_balance` checks the refund and that the other visitor's row is unchanged.

## What the owner pays

`node backend/scripts/deploy-mainnet-board.js` prints the storage stake, the burned gas, the 0.007 NEAR account-creation charge, and the total, in yoctoNEAR. The formula is `deployCost` in `shared/board/cost.js`. The script exits 1 if the total or the peak (stake plus prepaid gas) is over 1.2 NEAR (the live wasm is 108955 bytes, about 1.09 NEAR of storage, returned by `reap`). It does not sign unless the owner passes `--live` and `NEAR_MAINNET_SIGNER_KEY`. The key is not read from a file and is not printed.

The account is created with no access key. `new` records the predecessor as the owner.

## Teardown

1. A visitor calls `close_charter`. That returns their row stake and their unspent balance. The owner can call `force_close(visitor)` and the same refund goes to that visitor, so one abandoned row cannot block teardown. `reap` refuses while any row is open (`ERR_NONEMPTY`).
2. When `get_config` reports `rows: 0`, the owner calls `reap` with exactly 1 yoctoNEAR. The contract deletes its own account and the balance, including the wasm stake, goes to the owner (`nearcarta.near`).

Gas burned by deploy, by payments, and by the 0.007 NEAR account-creation charge does not come back. The unit test `a_failed_transfer_returns_the_balance_and_the_owner_cannot_reap_early` checks the empty-board requirement, the owner check, the 1 yocto deposit, and the delete. `force_close_refunds_that_visitor_and_then_the_owner_can_reap` checks the owner refund, that the other row is unchanged, and that `reap` runs once the last row is gone.

## Redeploy

The live account has no access key (`full_access_keys` is 0 in `shared/deployments/mainnet.json`) and the wasm has no upgrade method. Nothing can deploy new code onto it. `force_close` is in this source. It is not in the wasm that is live (code hash `6aBm6TugZzge9uHDpSsr6pG7XPfZm22JoZ8XZxknRGsa`, deploy `CaZr8GmMM83WUEESUShTiKtth8PWgxtRTesYGs1mkdpt`). This repo does not sign a replacement. A `view_access_key_list` read on this change returned no keys, and no signer was set, so no deploy transaction and no payment were sent. Replacing the account still requires every open row to call `close_charter` first, which returns that visitor's balance. That is not a test amount.

The `STATE` key layout did not change: `force_close` adds no field. `propose_call` stores its allowlist in a separate `CALLS` key, which `save` writes only after `set_calls`. A board with no call policy has no `CALLS` key, and `encode` of `STATE` stays the same bytes. `state_roundtrips_and_wallet_json_parses` still decodes a board written by this code. `the_live_state_dump_still_decodes_and_propose_is_unchanged` decodes the `view_state` copy in `contracts/charter_board/testdata/mainnet-state.bin` (block 223191542, 804 bytes, 2 rows), checks `get_charter` against `testdata/mainnet-views.json`, refuses a bad `propose` signature without moving the row, refuses `propose_call` with `method_not_allowlisted` until `set_calls`, and then pays the copied row's minimum with `propose`. The `propose` argument names are unchanged. A later wasm can read those rows only if it is built with near-sdk 5.27.0 and rustc 1.86.0 (`contracts/charter_board/rust-toolchain.toml`). The near-sdk 5.30 wasm did not link on mainnet (`failed_deploy_tx` `4mq8P3jugnatzbbc9VzDbufCBpyj27TxwK4w3L7nTPCX`, unknown import). Do not build the replacement with that sdk.

Because the live account cannot take new code, the owner does this by hand:

1. Each visitor calls `close_charter` on the live board. That is the only refund on the live wasm. The owner cannot `force_close` there yet. The contract does not list row keys, so the owner uses the visitors they already know (the proof row is the owner account in `board.proof`).
2. When `get_config` reports `rows: 0`, the owner calls `reap` with 1 yoctoNEAR. The account is deleted and the wasm stake returns to `nearcarta.near`.
3. The owner creates the subaccount again and deploys this crate's wasm, built with rustc 1.86.0 and near-sdk 5.27.0, then calls `new`. The new board starts empty. The rows were refunded in step 1, not dropped. From then on `force_close` is what lets `reap` run without waiting on a visitor.

`node backend/scripts/deploy-mainnet-board.js` still prints the cost and does not sign unless the owner passes `--live`.

## The site

`/setup` sends `open_charter` only when the build has `NEXT_PUBLIC_MAINNET=1` and `board.status` is `deployed`. Until then the page shows the town's mainnet transactions and does not send a create. With the flag unset, the guest trial on earlier network stays available and is labeled earlier network. Shops on the flagged build read the visitor's row and ask the board with the agent signature. They do not open the guest trial.
