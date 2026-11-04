# Mainnet visitor board

One contract holds every visitor's charter. The row key is the visitor's NEAR account. The lock factory in `docs/MAINNET_FACTORY.md` is not this path: copying the oath wasm onto each charter costs more than `nearcarta.near` can fund, and a global contract burns storage that `reap` cannot return.

The account id is `board.contract` in `shared/deployments/mainnet.json`. It is live on mainnet: deploy tx `CaZr8GmMM83WUEESUShTiKtth8PWgxtRTesYGs1mkdpt`, 86,762 bytes, no access key. The proof run is `backend/scripts/board-proof-mainnet.js`.

## What a row stores

Allowlist (at most 8 accounts), per-payment cap, daily budget, payments per day, time window, freeze flag, sealed-rule commitment, and the agent's ed25519 public key. The contract checks a signature over `board-v1|<contract>|<owner>|<receiver>|<amount>|<nonce>`. There is no access key on the board account, so one visitor's key cannot spend another visitor's row.

The refusal strings match the oath charter: `receiver_not_allowlisted`, `zero_amount`, `below_min_amount`, `outside_time_window`, `over_per_action_cap`, `over_daily_budget`, `over_daily_action_count`, `frozen`, `clause_expired`. A sealed rule uses the `oath-hidden-v1` commitment and refuses with `hidden_rule_receiver` or `hidden_rule_cap`.

## What the visitor pays

`open_charter` locks the bytes that row adds to this contract's state, keeps the `fund` argument as spendable balance, and transfers the rest of the attached deposit back. A row over 0.02 NEAR is refused (`ERR_ROW_TOO_BIG`). `close_charter` deletes the row and sends the storage stake plus the unspent balance back to that visitor. The unit test `a_row_costs_at_most_0_02_near_and_the_rest_is_refunded` measures the lock. `close_refunds_the_row_stake_and_the_unspent_balance` checks the refund and that the other visitor's row is unchanged.

## What the owner pays

`node backend/scripts/deploy-mainnet-board.js` prints the storage stake, the burned gas, the 0.007 NEAR account-creation charge, and the total, in yoctoNEAR. The formula is `deployCost` in `shared/board/cost.js`. The script exits 1 if the total or the peak (stake plus prepaid gas) is over 1 NEAR. It does not sign unless the owner passes `--live` and `NEAR_MAINNET_SIGNER_KEY`. The key is not read from a file and is not printed.

The account is created with no access key. `new` records the predecessor as the owner.

## Teardown

1. Each visitor calls `close_charter`. That returns their row stake and their unspent balance. `reap` refuses while any row is open (`ERR_NONEMPTY`).
2. When `get_config` reports `rows: 0`, the owner calls `reap` with exactly 1 yoctoNEAR. The contract deletes its own account and the balance, including the wasm stake, goes to the owner (`nearcarta.near`).

Gas burned by deploy, by payments, and by the 0.007 NEAR account-creation charge does not come back. The unit test `a_failed_transfer_returns_the_balance_and_the_owner_cannot_reap_early` checks the empty-board requirement, the owner check, the 1 yocto deposit, and the delete.

## The site

`/setup` sends `open_charter` only when the build has `NEXT_PUBLIC_MAINNET=1` and `board.status` is `deployed`. Until then the page shows the town's mainnet transactions and does not send a create. With the flag unset, the guest trial on testnet stays available and is labeled testnet. Shops on the flagged build read the visitor's row and ask the board with the agent signature. They do not open the guest trial.
