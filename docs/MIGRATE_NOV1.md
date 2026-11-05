# Hackathon window and baseline tags

The hackathon rules count code written from the announcement on 2026-10-19 until 2026-11-14
(HACKATHON.md, Rules FAQ Q-001). A new repo is not required. A project can mark its baseline with
the tags `pre-hackathon` and `hackathon-submission` and link the diff from its README (Q-003).

This repo's first commit is 2026-10-28 (license, gitignore and gitleaks config only). Every
contract, earlier network account and transaction in `shared/deployments/earlier network.json` was made after
2026-10-19, so we keep this repo and these accounts. Nothing is redeployed for the window.

## Tags

| Tag | Commit | When |
|---|---|---|
| `pre-hackathon` | the root commit (license and config, no code) | set now |
| `hackathon-submission` | the commit we submit | set when we submit |

The judged work is the diff
[`pre-hackathon...hackathon-submission`](https://github.com/nearcarta/nearcarta/compare/pre-hackathon...hackathon-submission).
Tags are annotated, never moved and never force-pushed.

## Optional: fresh earlier network redeploy

Only needed if a key or viewing key is exposed or an account has to be retired. The dry run
checks every artifact and sends nothing:

    The fresh-deploy helper is not in this repo. The live contracts are already on mainnet.

For each step it prints the script, the artifact's sha256 and its NEAR code hash (base58 of the
sha256). Those must equal the `code_hash` values in `shared/deployments/earlier network.json` and the
reproducible builds in `judges/VERIFY.md`. It exits non-zero if an artifact or script is missing.

| # | Part | Script | Artifact |
|---|------|--------|----------|
| 1 | Charter factory + Town Hall | the factory worker's scripts | `charter_factory*.wasm`, global oath code |
| 2 | Vault Arena | removed from this repo | `arena.wasm` |
| 3 | Toll (MPC → Base EVM) | removed from this repo | `toll.wasm` |
| 4 | Oath R16 (rule expiry) | removed from this repo | `oath.r16.wasm` |
| 5 | Your House charter | removed from this repo | `oath.r11.wasm` |
| 6 | House deed (NEP-171) | removed from this repo | `house_nft.wasm` |
| 7 | Mist Bank payout | removed from this repo | — |
| 8 | Proof check + tables | `backend/scripts/verify-proofs.js`, `backend/scripts/readme-numbers.js` | — |

Each script writes new account names and tx hashes into its proof file; copy them into
`shared/deployments/earlier network.json` before the next step. Keys are made per step and stay outside
the repo, and no contract account keeps a full-access key. Accounts whose keys were ever shown
are retired. After a redeploy, `GET /api/health?deep=1` must report `routes_ok: true`.
