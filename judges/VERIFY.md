# Verify with commands

Nearcarta runs on NEAR mainnet. Every command below is read-only: nothing signs or spends.

| # | Command | Expected |
|---|---|---|
| 1 | `curl -s https://nearcarta.vercel.app/api/health` | `"network":{"name":"mainnet",...}`, `"near":{"chain_id":"mainnet",...}`, `"features":{...,"signing":false}` |
| 2 | `curl -s "https://nearcarta.vercel.app/api/ai/tee?nonce=$(openssl rand -hex 32)"` | NEAR AI Cloud attestation: `"tcbStatus":"UpToDate"`, every field in `checks` is `true`, `nonce` echoes yours |
| 3 | `simulate` on `board.nearcarta.near` for the demo row (the RPC command is in README.md, Verify it yourself) | `{"ok":false,"reason":"frozen",...}` |
| 4 | `view_account` on `board`, `toll`, `arena`, `house`, `guard`, `townhall` `.nearcarta.near` | The code hashes in README.md, Contracts on mainnet; CI job `reproducible` rebuilds each one from source |
| 5 | `view_access_key_list` on `board.nearcarta.near` | `"keys":[]` |
| 6 | `npm ci && npm test` | 1140 tests, 1139 pass, 1 skipped (it would sign a real transaction) |
| 7 | `npm run verify:mainnet` | `205/205 mainnet txs found`, written to `judges/proofs/mainnet-proof-check.json`. Rows marked `failure: true` are intended refusals |
| 8 | `cargo test --lib` in any crate under `contracts/` | All pass; CI runs 400 contract unit tests and 61 sandbox tests |
| 9 | `gitleaks git --config .gitleaks.toml --redact .` | no leaks found |

Every transaction cited in README.md opens on https://nearblocks.io (mainnet), https://testnet.nearblocks.io (testnet) or https://basescan.org (Base).
