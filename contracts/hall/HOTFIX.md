# Town Hall hotfix, 2026-11-09

The live `townhall.nearcarta.near` runs the source at commit `c3a6e315` with one line changed. `migrate` now requires `predecessor == current_account_id`. Before the fix it also accepted `predecessor == owner`, and `owner` is an argument, so any caller could name itself owner, wipe the jobs and `close` the account.

- Deploy: `71QKJYqcxquc2Ku8Vqy8osRMBpCxRKHNSQ3dhBcVrk3s`. A DeployContract action signed with the account's own key, with no migrate call, so the state is untouched.
- Code hash: `GgECZv7g1tSGvnXeMLuJrQKYcfjBVwdXHyS1TZn6T6N8`. Artifact `contracts/artifacts/hall.wasm`, sha256 `e8ebe14e760d2fa0658237a6d75393bb4eff23e7a7fa824fa2040024f215bffd`, 217308 B.
- Build: `git archive c3a6e315 contracts/hall`, apply the one-line change, then `cargo +1.86.0 near build non-reproducible-wasm --locked --no-abi` and `wasm-opt` 108 `-Oz --strip-debug --strip-producers --enable-sign-ext --enable-mutable-globals --enable-bulk-memory`. Two builds gave the same sha.
- Proof: a stranger's `migrate` was refused `ERR_MIGRATE` on chain in `A5jtjqhCGH8Qn2GWodeAEiExDz3nkbTC4gSb7f8N5X4v`. The unit test is `a_stranger_naming_itself_owner_cannot_migrate`.

Since then `src/` on main is the deployed layout again. Commit `ce6bff5a` is exactly the live source and rebuilds to `e8ebe14e` (the `reproducible` CI job checks this). The `settled` redesign was dropped: it stranded spare escrow, while the live `remaining - locked` refund is correct. The next commits keep the same Borsh layout, so they deploy with no migration:

- an award must be covered by unlocked escrow (`ERR_ESCROW`),
- a refund closes the parts that were never awarded, so their budget cannot pay a later award from another part's escrow,
- `post_job` returns `U64`,
- a withdrawn stake is removed, and `prune` deletes finished jobs and zero stakes so `close` stays bounded,
- `close` refuses while any job or stake is left.
