# What a history rewrite would need (not done)

The first Mist Bank payout's viewing key (UFVK) was committed in `ae15658` and removed in
`f19e12f`. It is still in git history. This note lists what removing it from history would take.
**Nothing here has been done.** A rewrite needs a force push, and this repo never force-pushes.

## Why it is not needed now

The key is a view-only key for one payee account (`mist-payee` in the retired `payee` wallet). It
cannot spend. It shows one old earlier network payout (the amount, the memo and the salt of that payout)
and nothing else, because ZIP 32 account keys are hardened: one account's UFVK says nothing about
another account's.

The live proof has been rotated. `judges/proofs/mistbank-payout.json`, `shared/deployments/earlier network.json`
and `/api/mistbank` now point to a new payout to a fresh payee account in the `payee-r2` wallet. That
account's viewing key has never been in git, in an API response or in a log. It is held only in
`.secrets/` (outside the repo) for an auditor. The old key opens nothing that is served.

## What a rewrite would need

1. **Owner approval.** It rewrites every commit from `ae15658` on (about 310 commits) and needs a
   force push to `main`.
2. **The tool.** `git filter-repo --replace-text expressions.txt` with one line,
   `<old UFVK>==>REDACTED`, run on a fresh mirror clone (`git clone --mirror`). The two files
   touched are `judges/proofs/mistbank-payout.json` and `shared/deployments/earlier network.json`.
3. **Tags.** `build-1b8fd86`, `build-864d0f5` and `build-e7a8186` would move to new hashes. They are
   annotated and are meant never to move.
4. **On-chain build links break.** The contracts were built reproducibly and their NEP-330
   `contract_source_metadata` names the exact git revision (for example the USDC Toll links
   `tree/1b8fd86…`). These contracts have no full-access key, so they cannot be redeployed with new
   links. After a rewrite, revisions 1b8fd86, 864d0f5, e7a8186, 3709807, 5099a7c, 6079a71, 8c7a1f2 and
   85e0563 would no longer exist on `main`, and anyone checking a contract against its source
   would fail.
5. **Docs.** README.md, judges/VERIFY.md and the proofs cite about 20 short commit hashes. Every
   one would need updating.
6. **Copies GitHub keeps.** Old commits stay reachable through cached views, pull-request refs and
   forks until GitHub Support runs a garbage collection on request. Every clone, including the
   agent worktrees on the box, would need a re-clone. CI caches and the Render image built from the
   old history would also need rebuilding.

## Decision

The decision is the owner's. Recommended: no rewrite. The rotated proof removes the live risk, and
a rewrite would break the reproducible-build links that judges check.
