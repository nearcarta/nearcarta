# Next board deploy

The board source on main carries B1–B4 from `docs/AUDIT.md`. It is not deployed yet: it ships with the
next board deploy the game work needs, so the board is redeployed once.

Until then the live board still has B1 (an effects set/clear cycle can draw down the board's free
balance, which today is about the size of one row's float). If that balance grows, deploy sooner.

Before it ships, these callers must attach 1 yocto, because the new board refuses 0 on loosening calls:

- `shared/hall/plan.js`: `set_rules` and `set_frozen` (unfreeze) deposits.
- `shared/setup/open-row.js`: `set_effects`.
- `app/src/panels/hall.js`: the three board calls around lines 109–126.
- `app/design/D8_shops/js/apps.js`: `hallSign` asserts deposit 0 for board calls.

Freezing (`set_frozen(true)`) stays allowed at 0, so the guard agent needs no change.

Build and check: `contracts/scripts/rebuild.sh` (nep330 recipe) at the merge commit, then set the board
entry in `contracts/deployed.json` to `"build": "nep330"` and update the artifact.
