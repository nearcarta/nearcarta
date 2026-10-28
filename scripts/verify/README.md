# Verify the contracts yourself

Everything here reads public testnet state or builds from this repo. No keys, no signing.

| Script | What it checks | Needs |
|---|---|---|
| `recheck_r16.py` | Re-derives `judges/proofs/r16-factory.json` from RPC: artifact hashes, the global code on chain byte-equal to `oath.r16.oz.wasm`, factory locked (0 keys) and pinned, arena/redteam charters registered with one propose-only key, and every proof tx re-read FINAL (H14 `ERR_LOW_GAS` with no event, H15 refusals, arena attacks refused with the logged reason). | Python 3 (stdlib only). Optional `WASM_OPT` = binaryen version_133 `wasm-opt` to re-run the `-Oz` step. |
| `verify.sh` | `cargo test` (unit + sandbox), reproducible build of commit `5099a7c` (clean clone; the build records its commit) sha256 == `contracts/artifacts/oath.r16.wasm`, `cargo mutants` on the policy functions (0 missed), gitleaks, then `recheck_r16.py`. `--offline` skips the RPC step. | Rust, `cargo near`, Docker (for the reproducible build), optional `cargo-mutants`, `gitleaks`. |
| `run_r16.sh` | `verify.sh`, plus the oath sandbox and exploit suites run against the deployed `-Oz` bytes, the factory tests, and factory mutants. | Same as `verify.sh`. |
| `js_mutants.mjs` + `mutants-board.json` | Targeted mutants on the leaderboard rebuild in `backend/src/vault.js` (index retries, paging, `complete` only when nothing failed, boot retry loop); each must fail `backend/test/unit/vault.test.js`. `node scripts/verify/js_mutants.mjs scripts/verify/mutants-board.json` | Node 22, `npm ci` in `backend/`. |
| `nearrpc.py` | Small read-only RPC helper with retries over `NEAR_RPC` and `NEAR_RPC_FALLBACKS`. | |

```bash
python3 scripts/verify/recheck_r16.py          # about 30 s, prints OK/BAD per claim, exit 1 on any BAD
scripts/verify/verify.sh                        # full run; cargo mutants takes the longest
```

`gitleaks.toml` is the config used for the contract crate: default rules, build output ignored, and NEAR RPC
error text that quotes a 32-byte public key is not flagged (64-byte private keys still are).
