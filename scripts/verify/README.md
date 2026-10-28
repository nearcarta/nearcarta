# Verify the contracts yourself

Everything here reads public testnet state or builds from this repo. No keys, no signing.

| Script | What it checks | Needs |
|---|---|---|
| `recheck_r16.py` | Re-derives `judges/proofs/r16-factory.json` from RPC: artifact hashes, the global code on chain byte-equal to `oath.r16.oz.wasm`, factory locked (0 keys) and pinned, arena/redteam charters registered with one propose-only key, and every proof tx re-read FINAL (H14 `ERR_LOW_GAS` with no event, H15 refusals, arena attacks refused with the logged reason). | Python 3 (stdlib only). Optional `WASM_OPT` = binaryen version_133 `wasm-opt` to re-run the `-Oz` step. |
| `verify.sh` | `cargo test` (unit + sandbox), reproducible build of commit `5099a7c` (clean clone; the build records its commit) sha256 == `contracts/artifacts/oath.r16.wasm`, `cargo mutants` on the policy functions (0 missed), gitleaks, then `recheck_r16.py`. `--offline` skips the RPC step. | Rust, `cargo near`, Docker (for the reproducible build), optional `cargo-mutants`, `gitleaks`. |
| `run_r16.sh` | `verify.sh`, plus the oath sandbox and exploit suites run against the deployed `-Oz` bytes, the factory tests, and factory mutants. | Same as `verify.sh`. |
| `js_mutants.mjs` + `mutants-board.json` | Targeted mutants on the leaderboard rebuild in `backend/src/vault.js` (paging, `complete` only when nothing failed or was left over budget, boot retry loop, the 2.5 s cap on a board request); each must fail `backend/test/unit/vault.test.js`. `node scripts/verify/js_mutants.mjs scripts/verify/mutants-board.json` | Node 22, `npm ci` in `backend/`. |
| `js_mutants.mjs` + `mutants-rebuild.json` | Mutants on the nonce-coverage rebuild in `backend/src/vault.js` (only a successful propose / propose_batch signed by the charter counts a nonce, coverage needs every nonce below `next_nonce`, a covered charter skips the index, RPC trouble is an error and not "not arena"); each must fail `backend/test/unit/vault-rebuild.test.js`. | Node 22, `npm ci` in `backend/`. |
| `js_mutants.mjs` + `mutants-txindex.json` | Mutants on the shared tx-index gate `backend/src/txindex.js` (the board yields to the chronicle, 4xx is final, one shared exponential cooldown, success resets it); each must fail `backend/test/unit/txindex.test.js`. | Node 22. |
| `js_mutants.mjs` + `mutants-chronicle.json` | Mutants on `txOf` in `backend/src/shops.js`, which decides whether a known tx hash re-read from RPC belongs to a charter (signer/receiver, or the factory call that created it); each must fail `backend/test/unit/vault-rebuild.test.js`. | Node 22. |
| `board_snapshot.mjs` | Regenerates `backend/data/vault-board-snapshot.json`: a full board backfill from the tx index, each tx verified on RPC, plus the propose nonces seen. The server re-reads every snapshot hash from chain at boot before trusting it. `--check` reports coverage only. | Node 22, network to RPC and the FastNEAR tx index. |
| `js_mutants.mjs` + `mutants-agentkeys.json` | Mutants on `shared/vault/agentkeys.js`, the agent-key plan the vault page uses (promote a pending key once it is on chain, reuse a saved pending key, only `get_state.agent_key` is revocable); each must fail `backend/test/unit/agentkeys.test.js`. `node scripts/verify/js_mutants.mjs scripts/verify/mutants-agentkeys.json` | Node 22, `npm ci` in `backend/`. |
| `a1_proof.mjs` | On testnet with two fresh faucet accounts: a delay below 10 min is refused, a charter made with a 10 min timelock and a DAO records both, the owner cannot undo a DAO freeze, a looser clause is queued and cannot run before its eta (with `--wait`, it applies after). Writes `judges/proofs/a1-timelock-dao.json`. `node scripts/verify/a1_proof.mjs --wait` | Node 22, `npm ci` in `backend/`, network. |
| `nearrpc.py` | Small read-only RPC helper with retries over `NEAR_RPC` and `NEAR_RPC_FALLBACKS`. | |

```bash
python3 scripts/verify/recheck_r16.py          # about 30 s, prints OK/BAD per claim, exit 1 on any BAD
scripts/verify/verify.sh                        # full run; cargo mutants takes the longest
```

`gitleaks.toml` is the config used for the contract crate: default rules, build output ignored, and NEAR RPC
error text that quotes a 32-byte public key is not flagged (64-byte private keys still are).
