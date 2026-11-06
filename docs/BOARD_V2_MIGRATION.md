# Board v2 dry-run

This is a plan for the owner. Nothing in this file was sent to mainnet. No account was created, no wasm was deployed, and no row was closed.

The source adds `propose_call_as`, effect budgets, a second confirm key, monotonic `tighten_*`, salted anchors, and a delayed `stage_upgrade` / `upgrade` / `migrate`. The account `board.nearcarta.near` is still the 2026-11-05 wasm. That wasm has no upgrade method and the account has no access key, so the new code cannot be deployed onto it. The path is refund, then `reap`, then create the same name again.

## What is live

Read-only views on 2026-11-06, `https://rpc.mainnet.fastnear.com`, finality `final`. Account id from `shared/deployments/mainnet.json`.

| | |
|---|---|
| Account | `board.nearcarta.near` |
| Owner | `nearcarta.near` |
| Code hash | `Am4FLfphc4JF7ZZLRrs3j1otwyKyiQZqygBJ8nnZs78C` |
| Wasm sha256 | `910268dab146a99f766ebf400c464672bdb46adc3c914a91594a768b1b2e0f29` |
| Deploy tx | `CfdUppnLoLmFhcvLcgqE93XDygXCpwfPKdL7DHPUqV4` |
| Live wasm on the account | 108955 bytes, sha256 above |
| Committed v2 artifact | `contracts/artifacts/charter_board.wasm`, 132083 bytes, sha256 `982bf6b6666e626d6af267c8a780cf5bb93cd73b2864a68b0c02dca4d07af9a1` |
| Access keys | 0 |
| `get_config` | `rows` 1, `max_row_yocto` `20000000000000000000000` |
| Account amount | `1302749999999999999999995` yoctoNEAR |
| `storage_usage` | 110174 bytes |
| State keys | `STATE` 505 bytes, `CALLS` 524 bytes. No `ACTS`. No `META`. |

The one open row is the visitor already published in `board.visitor_run.signer` of `shared/deployments/mainnet.json`. `get_charter` for that account:

| field | value |
|---|---|
| `balance` | `201499999999999999999995` |
| `storage_locked` | `9950000000000000000000` |
| `nonce` | `23` |
| `frozen` | false |

`balance` plus `storage_locked` is `211449999999999999999995` yoctoNEAR. That is the visitor's money. It is not treasury and it is not the stake for a new wasm. `reap` sends the whole account to `nearcarta.near`, so it must not run while this row is open.

The contract does not list row keys. `rows: 1` matched this known visitor. The owner re-reads `get_config` and this `get_charter` immediately before any close. A second row would show up as `rows` greater than 1.

## The wasm that was compiled and not deployed

```bash
cd contracts/charter_board
cargo +1.86.0 near build non-reproducible-wasm --locked --no-abi
wasm-opt --enable-sign-ext --enable-mutable-globals --enable-bulk-memory -Oz --strip-debug --strip-producers -o target/near/charter_board.wasm target/near/charter_board.wasm
```

Toolchain: rustc 1.86.0, near-sdk 5.27.0, cargo-near 0.22.0. `--no-abi` is required because the methods are `extern "C"` and cargo-near finds no ABI symbols. Do not build with near-sdk 5.30. That wasm failed to link on mainnet (`failed_deploy_tx` `4mq8P3jugnatzbbc9VzDbufCBpyj27TxwK4w3L7nTPCX`).

Output: `contracts/charter_board/target/near/charter_board.wasm`.

| | |
|---|---|
| Bytes | 132083 |
| sha256 | `982bf6b6666e626d6af267c8a780cf5bb93cd73b2864a68b0c02dca4d07af9a1` |

`deployCost` in `shared/board/cost.js` for 132083 bytes and owner `nearcarta.near`:

| | yoctoNEAR |
|---|---|
| Storage bytes | 132325 |
| Stake | `1323250000000000000000000` (1.32325 NEAR) |
| Burned gas | `2432319275499500000000` |
| Account creation | `7000000000000000000000` |
| Total | `1332682319275499500000000` |
| Peak the owner must hold to send it | `1347573192754995000000000` |

The committed artifact is this file. `MAX_DEPLOY_YOCTO` is 2.1 NEAR and the script prints that maximum. `mainnet.json` still names the live hash `910268dab146a99f766ebf400c464672bdb46adc3c914a91594a768b1b2e0f29`. Docker is not on this machine, so this is not a cargo-near reproducible-wasm build. The bytes come from `cargo +1.86.0 near build non-reproducible-wasm --locked --no-abi` and then `wasm-opt --enable-sign-ext --enable-mutable-globals --enable-bulk-memory -Oz --strip-debug --strip-producers`.

A plain `cargo build --target wasm32-unknown-unknown --release` wasm was not used. The near-sandbox rejected it while deserializing. The cargo-near file above is the one the sandbox deployed.

## What the tests measured

`cargo +1.86.0 test --lib --locked` in `contracts/charter_board`: 30 passed. `storage_fees_cover_rows_of_different_sizes_and_the_free_balance_holds` opens and closes a one-receiver row and an eight-receiver row in one VM and checks the contract's free balance does not fall. `the_live_state_dump_still_decodes_and_propose_is_unchanged` still decodes `testdata/mainnet-state.bin` (block 223191542, 804 bytes, 2 rows) and the encoded `STATE` of that dump is unchanged. `init` state stays 30 bytes for `nearcarta.near`.

The 24-pair row in `calls_stop_at_24_pairs_and_tightening_cannot_grant_or_reset` encodes `CALLS` as 836 bytes and locks `19940000000000000000000` yoctoNEAR (0.01994 NEAR). The lock is the trie bytes `env::storage_usage` measured around the write, plus the 600-byte side reserve (`SIDE_RESERVE_BYTES`). A growth that is not covered by that reserve also adds `STORAGE_MARGIN_BYTES` (32). Close refunds the measured drop, so the margin stays with the contract. Pay receivers stay at 8. `expire_sent` does not credit a row after a 20 Tgas callback that ran out of gas: that callback cannot tell a shop that kept the NEAR from one that refunded it.

`contracts/charter_board_sandbox` (rustc 1.95.0, near-workspaces 0.24) deploys the cargo-near wasm onto one local account and opens two rows. Neither visitor account has a contract. A failed shop call refunds only that visitor. Alice's `propose` does not move Bob's balance. After both `close_charter` calls, `get_liabilities` is 0 and the owner `reap`s with 1 yocto. The sandbox registrar cannot create `nearcarta.near`, so that test's owner is the account `nearcarta` and `new` records it. `reap` pays `self.owner`. The unit tests boot with predecessor `nearcarta.near`, which is the production beneficiary.

Gas burned in that sandbox run of this wasm: the two `propose_call_as` calls together cost `22626885277974` gas. One `propose` cost `7717616996613` gas. The board account with two rows reported `storage_usage` 134096.

## Sequence, not executed

1. Re-read `get_config`, the known visitor's `get_charter`, `view_account`, and the state-key list. Stop if `rows` is not the one known visitor, or if `balance` and `storage_locked` are not still that visitor's.
2. That visitor calls `close_charter`. The 2026-11-05 deployment record says `force_close` is in the live wasm and the refund goes to the visitor, not to an account the caller picks. Prefer the visitor's own `close_charter`. Do not spend the row to pay for the new wasm. If the refund receipt fails because the account is short, the owner tops the contract up from `nearcarta.near` and retries the close. The top-up is not recovered by taking the visitor's balance.
3. Re-read `get_config`. `rows` must be 0. The live wasm has no `get_liabilities`. The check on that wasm is `rows: 0` and an account balance that no longer contains the visitor's `balance`.
4. The owner calls `reap` with exactly 1 yoctoNEAR. The contract deletes the account and the remainder, including the old wasm stake, goes to `nearcarta.near`.
5. Create `board.nearcarta.near` again. Deploy the wasm above. The stake is about 1.32325 NEAR, under the 2.1 NEAR maximum. Call `new` from `nearcarta.near`. The board starts empty. Visitors open rows again in `/setup`.
6. After that deploy, a later upgrade is `stage_upgrade` (1 yocto, owner, code hash), a wait of one day (`86400000000000` nanoseconds), then one receipt that deploys the wasm and calls `migrate`. `migrate` copies a v1 `STATE` blob into keyed rows and does not change balances. This change did not stage anything.

`scripts/board-v2-migrate.js` prints this sequence and does not sign. Step 0 retires `charter.nearcarta.near`: `queue_upgrade` of the reaper sha256 `afe81ba2a0f07af4de3b849aac4f62db9e22d777ef445077a215209eea0ac199`, wait 90 seconds, `execute_change` (the oath will not upgrade until the hash is marked ready), `upgrade` with the raw reaper bytes, then `reap` to `nearcarta.near`. The script refuses a payee other than the open row's owner or `nearcarta.near`. `scripts/board-v2-smoke.js` prints the wrap smoke and does not sign.

Rows, holds and effects are keyed (`LookupMap`). Callbacks get 20 Tgas. `expire_sent` drops a sent hold after it expires, with no refund. `confirm_hold` rechecks freeze, the rule expiry, the confirm key and the policy epoch stored on the hold. The row owner can `cancel_hold` a pending hold. A hold cannot expire more than a day out. `propose_call` and `propose_call_as` use the rule window, the minimum and the receiver list. `stamp` on the board returns its NEAR to the row. Ferry Ask charter calls that method instead of paying `charter.nearcarta.near`.

`close_charter` and `force_close` both refuse with `ERR_IN_FLIGHT` while that visitor has a hold. The live account has no holds. The new code does.

## The first shop that calls it

The board v2 change on its own did not change Toll, Guard, House, Arena, Hall, Bank, Payouts, or Chronicle. The toll branch is the first shop that calls `propose_call_as`, from `app/design/D8_shops/js/apps.js`. The signed envelope is `app/src/board-call-as.js`, and `shared/board/call-as.js` re-exports it so node tests import the same bytes the browser signs. Test: `board v2 injects the top-level row_owner` (`backend/test/unit/toll-board-v2.test.js`).

`propose_call_as` checks the active agent key over `board-call-as-v1`, the network (default `mainnet`, stored outside the `STATE` blob), the contract account, version `2`, the owner, the receiver, the method, the sha256 of the injected args, the deposit, the nonce, the expiry, the policy epoch, and the effect list. Args must be a JSON object. The contract overwrites a top-level `row_owner` with the row owner and rejects a duplicate of that key. A nested `row_owner` is not authority. A shop accepts the call only when `predecessor` is the board and the top-level `row_owner` is the visitor. `propose` and `propose_call` are unchanged.

`propose_call` still caps the NEAR deposit only. An empty effect list on `propose_call_as` also means NEAR only. A non-empty effect with no matching budget panics `ERR_EFFECT` and creates no promise. A shop that keeps calling `propose_call` for wNEAR is still doing that, and that call is not a foreign-asset authorization. Setup records chain, asset, receiver, value, and fee through `set_effects`, which is owner-signed because raising a cap is a privilege expansion. `tighten_effects` can only lower a cap. A counter that has been spent cannot be deleted. The reservation is released when the promise fails, when the receiver refunds the exact amount, or when a pending hold is past expiry. `settle` is the receiver, after the call has been sent, and it keeps the reservation. A stranger cannot refund. A plain transfer to the board is not a row refund: `fund` credits only the predecessor's own row.

`tighten_rules` and `tighten_calls` can shrink a cap, a receiver list, a method list, or the expiry, and can freeze. They cannot unfreeze, raise a cap, grant a call, or reset `spent`, the day, or the nonce. `set_frozen(false)` stays the owner's unfreeze. The contract sees the same predecessor for the session key and the owner's full-access key, so setup must not put `set_rules`, `set_frozen`, `set_agent`, or `set_effects` on the session key.

`confirm_hold` checks a second key, `set_confirm_key`, which must differ from the agent key (`ERR_CONFIRM`). The message is `board-confirm-v1|<contract>|<owner>|<action_id>|<digest>|present`. The agent key cannot sign it. A browser that holds the confirm key can sign `present` without another wallet popup. That is the compromise boundary.

`anchor` writes an `EVENT_JSON` log of a salted commitment, `sha256(salt || digest bytes)`, and stores nothing. The salt is required, 8 to 64 alphanumeric characters (`ERR_SALT`). The salt and the raw digest are not logged. There is no `anchors_of` map. A history view has to be rebuilt from the logs.

Epoch, confirm key, and the upgrade record live in `META` and are not charged to the visitor. The 600-byte side reserve is charged to the visitor on `set_calls` and is refunded on `close_charter`. New fields are not added to the row or to `encode` of `STATE`.
